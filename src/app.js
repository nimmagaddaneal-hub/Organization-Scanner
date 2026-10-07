import express from 'express';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createItem } from './db.js';
import {
  ADMIN_COOKIE,
  parseCookies,
  safeEqual,
  createSessionValue,
  readSession,
  hashPassword,
  verifyPassword,
  sessionMaxAgeMs,
  createRateLimiter,
} from './auth.js';
import * as views from './views.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETURN_COOKIE_DAYS = 180;

function todayLocal() {
  // en-CA formats as YYYY-MM-DD in the server's time zone (set TZ to change it).
  return new Date().toLocaleDateString('en-CA');
}

function text(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isRealDate(day) {
  if (!DATE_PATTERN.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

// Stop spreadsheet programs from running a cell as a formula.
function csvCell(value) {
  let cell = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}

export function createApp({
  db,
  sessionSecret,
  adminSignupCode = '',
  teacherSignupCode = '',
  baseUrl = '',
  emailDomain = '',
  trustProxy = false,
}) {
  if (adminSignupCode && adminSignupCode === teacherSignupCode) {
    throw new Error('The admin and teacher sign-up codes must be different');
  }
  if (!sessionSecret) throw new Error('sessionSecret is required');
  emailDomain = emailDomain.trim().toLowerCase().replace(/^@/, '');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const returnLimiter = createRateLimiter(5, 10 * 60 * 1000);
  const signupLimiter = createRateLimiter(8, 15 * 60 * 1000);

  app.use(async (req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // same-origin keeps the Origin header on our own form posts; the admin router checks it.
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
      // Pages hold personal data or per-student state. Never cache them.
      'Cache-Control': 'no-store',
    });
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));

  const cookieOptions = (req, extra) => ({ httpOnly: true, secure: req.secure, ...extra });

  const findItem = db.prepare('SELECT * FROM items WHERE code = ? AND active = 1');
  const findOpenCheckout = db.prepare('SELECT * FROM checkouts WHERE item_id = ? AND returned_at IS NULL');
  const markReturned = db.prepare(
    'UPDATE checkouts SET returned_at = ?, returned_by = ? WHERE id = ? AND returned_at IS NULL'
  );

  const returnCookieName = (item) => `rt_${item.code}`;
  const holdsItem = (req, item, checkout) =>
    Boolean(checkout) &&
    Boolean(req.cookies[returnCookieName(item)]) &&
    safeEqual(req.cookies[returnCookieName(item)], checkout.return_token);

  // ---------- Student routes ----------

  app.get('/', (req, res) => res.send(views.homePage()));

  // For handheld barcode scanners and typed codes: the barcode holds the item code.
  app.get('/find', async (req, res) => {
    const code = text(req.query.code, 40).toLowerCase();
    if (!/^[a-z0-9]+$/.test(code)) return res.redirect('/');
    res.redirect(`/i/${code}`);
  });

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Load the scanned item for every /i/:code route.
  app.param('code', async (req, res, next, code) => {
    let item;
    try {
      item = await findItem.get(String(code));
    } catch (error) {
      return next(error);
    }
    if (!item) {
      return res.status(404).send(
        views.messagePage({
          title: 'Item not found',
          message: 'This code does not match an item. Ask an organization officer for help.',
          status: 'warning',
        })
      );
    }
    req.item = item;
    next();
  });

  const formPage = (req, extra = {}) =>
    views.checkoutFormPage({
      item: req.item,
      today: todayLocal(),
      now: new Date().toISOString(),
      emailDomain,
      ...extra,
    });

  app.get('/i/:code', async (req, res) => {
    const checkout = await findOpenCheckout.get(req.item.id);
    if (!checkout) return res.send(formPage(req));
    if (holdsItem(req, req.item, checkout)) {
      return res.send(
        views.ownCheckoutPage({ item: req.item, checkout, justCheckedOut: req.query.done === '1' })
      );
    }
    res.send(views.unavailablePage({ item: req.item }));
  });

  app.post('/i/:code/checkout', async (req, res) => {
    const item = req.item;
    const values = {
      student_name: text(req.body?.student_name, 100),
      student_id: text(req.body?.student_id, 20),
      email: text(req.body?.email, 254).toLowerCase(),
      phone: text(req.body?.phone, 30),
      due_date: text(req.body?.due_date, 10),
      purpose: text(req.body?.purpose, 500),
    };

    const errors = [];
    if (!values.student_name) errors.push('Enter your full name.');
    if (!values.student_id) errors.push('Enter your student ID number (lunch number).');
    else if (!/^[A-Za-z0-9-]+$/.test(values.student_id)) {
      errors.push('Student ID can only contain letters, numbers and dashes.');
    }
    if (!values.email) errors.push('Enter your school email.');
    else if (!EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    else if (emailDomain && !values.email.endsWith(`@${emailDomain}`)) {
      errors.push(`Use your school email ending in @${emailDomain}.`);
    }
    if (values.phone && !/^[0-9+().\-\s]{7,30}$/.test(values.phone)) errors.push('Enter a valid phone number, or leave it empty.');
    if (!values.due_date) errors.push('Choose an expected return date.');
    else if (!isRealDate(values.due_date)) errors.push('Enter a valid return date.');
    else if (values.due_date < todayLocal()) errors.push('The return date cannot be in the past.');

    if (errors.length) return res.status(400).send(formPage(req, { values, errors }));

    const returnToken = randomBytes(24).toString('hex');
    try {
      await db.prepare(
        `INSERT INTO checkouts
           (item_id, student_name, student_id, email, phone, purpose, checked_out_at, due_date, return_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id,
        values.student_name,
        values.student_id,
        values.email,
        values.phone,
        values.purpose,
        new Date().toISOString(),
        values.due_date,
        returnToken
      );
    } catch (error) {
      // The unique index rejects a second open check-out for the same item.
      if (String(error.message).includes('UNIQUE')) {
        return res.status(409).send(views.unavailablePage({ item }));
      }
      throw error;
    }

    // Remember on this phone that this student holds the item, so a later scan offers "Return".
    res.cookie(
      returnCookieName(item),
      returnToken,
      cookieOptions(req, {
        sameSite: 'lax',
        path: `/i/${item.code}`,
        maxAge: RETURN_COOKIE_DAYS * 24 * 60 * 60 * 1000,
      })
    );
    res.redirect(303, `/i/${item.code}?done=1`);
  });

  app.post('/i/:code/return', async (req, res) => {
    const item = req.item;
    const checkout = await findOpenCheckout.get(item.id);
    if (!checkout) return res.redirect(303, `/i/${item.code}`);

    const limiterKey = `${req.ip}:${item.id}`;
    let allowed = holdsItem(req, item, checkout);

    if (!allowed) {
      if (returnLimiter.isBlocked(limiterKey)) {
        return res.status(429).send(
          views.unavailablePage({ item, errors: ['Too many attempts. Wait a few minutes or ask an officer for help.'] })
        );
      }
      const studentId = text(req.body?.student_id, 20);
      const email = text(req.body?.email, 254).toLowerCase();
      // Check both fields every time, and give one generic message, so the form reveals nothing.
      const idMatches = safeEqual(studentId.toLowerCase(), checkout.student_id.toLowerCase());
      const emailMatches = safeEqual(email, checkout.email);
      allowed = Boolean(studentId) && Boolean(email) && idMatches && emailMatches;
      if (!allowed) {
        returnLimiter.recordFailure(limiterKey);
        return res.status(403).send(
          views.unavailablePage({
            item,
            errors: ['Those details do not match this check-out. Check them, or ask an officer for help.'],
          })
        );
      }
    }

    await markReturned.run(new Date().toISOString(), 'student', checkout.id);
    returnLimiter.clear(limiterKey);
    res.clearCookie(returnCookieName(item), cookieOptions(req, { sameSite: 'lax', path: `/i/${item.code}` }));
    res.send(views.returnedPage({ item }));
  });

  // ---------- Staff routes (admins and teachers) ----------

  const admin = express.Router();

  // Block form posts that come from another website.
  admin.use(async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        // Leave empty so the check below fails.
      }
      if (originHost !== req.get('host')) return res.status(403).type('text').send('Forbidden');
    }
    next();
  });

  const findUser = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ? AND active = 1');
  // The account is looked up on every request, so deactivating someone takes effect at once.
  const currentUser = async (req) => {
    const userId = readSession(req.cookies[ADMIN_COOKIE], sessionSecret);
    return userId ? (await findUser.get(userId)) ?? null : null;
  };
  const startSession = (req, res, userId) =>
    res.cookie(
      ADMIN_COOKIE,
      createSessionValue(userId, sessionSecret),
      cookieOptions(req, { sameSite: 'strict', path: '/admin', maxAge: sessionMaxAgeMs })
    );
  const signupOpen = Boolean(adminSignupCode || teacherSignupCode);
  // Checked when the email is unknown, so a wrong email takes as long as a wrong password.
  const dummyHash = hashPassword(randomBytes(16).toString('hex'));

  admin.get('/login', async (req, res) => {
    if (await currentUser(req)) return res.redirect('/admin');
    res.send(views.loginPage({ signupOpen }));
  });

  admin.post('/login', async (req, res) => {
    const email = text(req.body?.email, 254).toLowerCase();
    if (loginLimiter.isBlocked(req.ip)) {
      return res.status(429).send(views.loginPage({ email, signupOpen, error: 'Too many attempts. Try again in 15 minutes.' }));
    }
    const account = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const passwordOk = verifyPassword(req.body?.password ?? '', account ? account.password_hash : dummyHash);
    if (!account || !passwordOk || !account.active) {
      loginLimiter.recordFailure(req.ip);
      return res.status(401).send(views.loginPage({ email, signupOpen, error: 'Wrong email or password.' }));
    }
    loginLimiter.clear(req.ip);
    startSession(req, res, account.id);
    res.redirect(303, '/admin');
  });

  admin.get('/signup', async (req, res) => {
    if (!signupOpen) return res.status(404).send(views.messagePage({ title: 'Sign-up is closed', message: 'Ask an administrator for help.', status: 'warning' }));
    res.send(views.signupPage());
  });

  admin.post('/signup', async (req, res) => {
    if (!signupOpen) return res.status(404).type('text').send('Sign-up is closed.');
    const values = { name: text(req.body?.name, 100), email: text(req.body?.email, 254).toLowerCase() };
    const password = String(req.body?.password ?? '');
    const signupCode = String(req.body?.signup_code ?? '');
    const fail = (status, errors) => res.status(status).send(views.signupPage({ values, errors }));

    if (signupLimiter.isBlocked(req.ip)) return fail(429, ['Too many attempts. Try again in 15 minutes.']);

    // The code decides the role. Without a valid code nobody gets an account.
    let role = null;
    if (adminSignupCode && safeEqual(signupCode, adminSignupCode)) role = 'admin';
    else if (teacherSignupCode && safeEqual(signupCode, teacherSignupCode)) role = 'teacher';

    const errors = [];
    if (!values.name) errors.push('Enter your full name.');
    if (!EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    if (password.length < 10) errors.push('Choose a password of 10 characters or more.');
    else if (password.length > 200) errors.push('Choose a password of 200 characters or fewer.');
    if (!role) {
      signupLimiter.recordFailure(req.ip);
      errors.push('That sign-up code is not correct.');
    }
    if (errors.length) return fail(400, errors);

    let userId;
    try {
      const result = await db
        .prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(values.name, values.email, hashPassword(password), role, new Date().toISOString());
      userId = result.lastInsertRowid;
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return fail(400, ['An account with this email already exists. Log in instead.']);
      throw error;
    }
    startSession(req, res, userId);
    res.redirect(303, role === 'admin' ? '/admin' : '/admin/items');
  });

  // Everything registered on this router below this line requires a staff login.
  admin.use(async (req, res, next) => {
    req.user = await currentUser(req);
    if (req.user) return next();
    if (req.method === 'GET') return res.redirect('/admin/login');
    res.status(401).type('text').send('Log in first.');
  });

  const requireAdmin = async (req, res, next) => {
    if (req.user.role === 'admin') return next();
    res.status(403).send(views.messagePage({ title: 'Admins only', message: 'Your account cannot open this page.', status: 'warning' }));
  };

  admin.post('/logout', async (req, res) => {
    res.clearCookie(ADMIN_COOKIE, cookieOptions(req, { sameSite: 'strict', path: '/admin' }));
    res.redirect(303, '/admin/login');
  });

  // Teachers see only items they listed and the check-outs of those items. Admins see everything.
  // Every query on items or check-outs below goes through this.
  function ownerScope(user, where, params) {
    if (user.role === 'admin') return;
    where.push('i.owner_id = ?');
    params.push(user.id);
  }

  // Shared search for the dashboard, the history view and the CSV export.
  function findCheckouts(user, { q = '', status = '', openOnly }) {
    const where = [];
    const params = [];
    const today = todayLocal();
    ownerScope(user, where, params);
    if (openOnly) where.push('c.returned_at IS NULL');
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      where.push(
        `(c.student_name LIKE ? ESCAPE '\\' OR c.student_id LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR i.name LIKE ? ESCAPE '\\')`
      );
      params.push(like, like, like, like);
    }
    if (status === 'overdue') {
      where.push('c.returned_at IS NULL AND c.due_date < ?');
      params.push(today);
    } else if (status === 'ontime') {
      where.push('c.returned_at IS NULL AND c.due_date >= ?');
      params.push(today);
    } else if (status === 'returned') {
      where.push('c.returned_at IS NOT NULL');
    }
    const order = openOnly ? 'c.due_date ASC, c.checked_out_at ASC' : 'c.checked_out_at DESC';
    return db
      .prepare(
        `SELECT c.*, i.name AS item_name
           FROM checkouts c JOIN items i ON i.id = c.item_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY ${order}`
      )
      .all(...params);
  }

  const filters = (req) => ({ q: text(req.query.q, 100), status: text(req.query.status, 20) });

  admin.get('/', async (req, res) => {
    const { q, status } = filters(req);
    const today = todayLocal();
    const open = await findCheckouts(req.user, { openOnly: true });
    const counts = { out: open.length, overdue: open.filter((row) => row.due_date < today).length };
    res.send(
      views.dashboardPage({ user: req.user, rows: await findCheckouts(req.user, { q, status, openOnly: true }), q, status, today, counts })
    );
  });

  admin.get('/history', async (req, res) => {
    const { q, status } = filters(req);
    res.send(
      views.historyPage({ user: req.user, rows: await findCheckouts(req.user, { q, status, openOnly: false }), q, status, today: todayLocal() })
    );
  });

  admin.post('/checkouts/:id/return', async (req, res) => {
    const where = ['c.id = ?'];
    const params = [Number(req.params.id)];
    ownerScope(req.user, where, params);
    const checkout = await db
      .prepare(`SELECT c.id FROM checkouts c JOIN items i ON i.id = c.item_id WHERE ${where.join(' AND ')}`)
      .get(...params);
    if (!checkout) return res.status(404).type('text').send('Check-out not found');
    await markReturned.run(new Date().toISOString(), req.user.role, checkout.id);
    res.redirect(303, '/admin');
  });

  admin.get('/export.csv', async (req, res) => {
    const openOnly = req.query.scope !== 'all';
    const today = todayLocal();
    const rows = await findCheckouts(req.user, { openOnly });
    const header = [
      'Item', 'Student name', 'Student ID', 'Email', 'Phone', 'Purpose',
      'Checked out', 'Due date', 'Returned', 'Returned by', 'Status',
    ];
    const lines = rows.map((row) =>
      [
        row.item_name, row.student_name, row.student_id, row.email, row.phone, row.purpose,
        row.checked_out_at, row.due_date, row.returned_at, row.returned_by,
        row.returned_at ? 'Returned' : row.due_date < today ? 'Overdue' : 'On time',
      ]
        .map(csvCell)
        .join(',')
    );
    res
      .type('text/csv')
      .attachment(`checkouts-${openOnly ? 'current' : 'all'}-${today}.csv`)
      .send(`﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`);
  });

  function findItems(user, { id, activeOnly = false } = {}) {
    const where = [];
    const params = [];
    ownerScope(user, where, params);
    if (id !== undefined) {
      where.push('i.id = ?');
      params.push(id);
    }
    if (activeOnly) where.push('i.active = 1');
    return db
      .prepare(
        `SELECT i.*, u.name AS owner_name,
                EXISTS(SELECT 1 FROM checkouts c WHERE c.item_id = i.id AND c.returned_at IS NULL) AS is_out
           FROM items i LEFT JOIN users u ON u.id = i.owner_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY i.active DESC, i.name COLLATE NOCASE`
      )
      .all(...params);
  }

  const itemValues = (req) => ({ name: text(req.body?.name, 100), description: text(req.body?.description, 200) });

  admin.get('/items', async (req, res) => res.send(views.itemsPage({ user: req.user, items: await findItems(req.user) })));

  // Listing an item makes its code at once and goes straight to the printable label.
  admin.post('/items', async (req, res) => {
    const values = itemValues(req);
    if (!values.name) {
      return res
        .status(400)
        .send(views.itemsPage({ user: req.user, items: await findItems(req.user), values, errors: ['Enter an item name.'] }));
    }
    const itemId = await createItem(db, { ...values, ownerId: req.user.id });
    res.redirect(303, `/admin/qr?item=${itemId}&listed=1`);
  });

  admin.get('/items/:id/edit', async (req, res) => {
    const [item] = await findItems(req.user, { id: Number(req.params.id) });
    if (!item) return res.status(404).type('text').send('Item not found');
    res.send(views.editItemPage({ user: req.user, item }));
  });

  admin.post('/items/:id', async (req, res) => {
    const [item] = await findItems(req.user, { id: Number(req.params.id) });
    if (!item) return res.status(404).type('text').send('Item not found');
    const values = { ...itemValues(req), active: req.body?.active === '1' ? 1 : 0 };
    if (!values.name) {
      return res
        .status(400)
        .send(views.editItemPage({ user: req.user, item: { ...item, ...values }, errors: ['Enter an item name.'] }));
    }
    await db.prepare('UPDATE items SET name = ?, description = ?, active = ? WHERE id = ?').run(
      values.name,
      values.description,
      values.active,
      item.id
    );
    res.redirect(303, '/admin/items');
  });

  admin.get('/qr', async (req, res) => {
    const single = req.query.item !== undefined;
    const items = await findItems(req.user, { id: single ? Number(req.query.item) : undefined, activeOnly: true });
    const root = (baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const labels = await Promise.all(
      items.map(async (item) => ({
        name: item.name,
        // QR code: opens the form on a phone. Barcode: the item code, for handheld scanners.
        svg: await QRCode.toString(`${root}/i/${item.code}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }),
        barcode: bwipjs.toSVG({ bcid: 'code128', text: item.code, height: 10, includetext: true, textxalign: 'center' }),
      }))
    );
    res.send(
      views.qrSheetPage({ user: req.user, labels, baseUrl: root, single, justListed: req.query.listed === '1' && labels.length > 0 })
    );
  });

  admin.get('/people', requireAdmin, async (req, res) => {
    const people = await db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name COLLATE NOCASE').all();
    res.send(
      views.peoplePage({ user: req.user, people, signup: { admin: Boolean(adminSignupCode), teacher: Boolean(teacherSignupCode) } })
    );
  });

  admin.post('/people/:id/active', requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    // Admins cannot deactivate themselves, so there is always one working admin.
    if (personId === req.user.id) return res.status(400).type('text').send('You cannot deactivate your own account.');
    await db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body?.active === '1' ? 1 : 0, personId);
    res.redirect(303, '/admin/people');
  });

  app.use('/admin', admin);

  app.use(async (req, res) => {
    res.status(404).send(views.messagePage({ title: 'Page not found', message: 'This page does not exist.', status: 'warning' }));
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).send(
      views.messagePage({ title: 'Something went wrong', message: 'Please try again in a moment.', status: 'error' })
    );
  });

  return app;
}
