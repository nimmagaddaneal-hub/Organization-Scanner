import express from 'express';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createItem } from './db.js';
import {
  ADMIN_COOKIE,
  parseCookies,
  safeEqual,
  createSessionValue,
  isValidSession,
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

export function createApp({ db, adminPassword, sessionSecret, baseUrl = '', emailDomain = '', trustProxy = false }) {
  if (!adminPassword) throw new Error('adminPassword is required');
  if (!sessionSecret) throw new Error('sessionSecret is required');
  emailDomain = emailDomain.trim().toLowerCase().replace(/^@/, '');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const returnLimiter = createRateLimiter(5, 10 * 60 * 1000);

  app.use((req, res, next) => {
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

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Load the scanned item for every /i/:code route.
  app.param('code', (req, res, next, code) => {
    const item = findItem.get(String(code));
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

  app.get('/i/:code', (req, res) => {
    const checkout = findOpenCheckout.get(req.item.id);
    if (!checkout) return res.send(formPage(req));
    if (holdsItem(req, req.item, checkout)) {
      return res.send(
        views.ownCheckoutPage({ item: req.item, checkout, justCheckedOut: req.query.done === '1' })
      );
    }
    res.send(views.unavailablePage({ item: req.item }));
  });

  app.post('/i/:code/checkout', (req, res) => {
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
    if (!values.student_id) errors.push('Enter your student ID number.');
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
      db.prepare(
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

  app.post('/i/:code/return', (req, res) => {
    const item = req.item;
    const checkout = findOpenCheckout.get(item.id);
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

    markReturned.run(new Date().toISOString(), 'student', checkout.id);
    returnLimiter.clear(limiterKey);
    res.clearCookie(returnCookieName(item), cookieOptions(req, { sameSite: 'lax', path: `/i/${item.code}` }));
    res.send(views.returnedPage({ item }));
  });

  // ---------- Admin routes ----------

  const admin = express.Router();

  // Block form posts that come from another website.
  admin.use((req, res, next) => {
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

  admin.get('/login', (req, res) => {
    if (isValidSession(req.cookies[ADMIN_COOKIE], sessionSecret)) return res.redirect('/admin');
    res.send(views.loginPage());
  });

  admin.post('/login', (req, res) => {
    if (loginLimiter.isBlocked(req.ip)) {
      return res.status(429).send(views.loginPage({ error: 'Too many attempts. Try again in 15 minutes.' }));
    }
    if (!safeEqual(req.body?.password ?? '', adminPassword)) {
      loginLimiter.recordFailure(req.ip);
      return res.status(401).send(views.loginPage({ error: 'Wrong password.' }));
    }
    loginLimiter.clear(req.ip);
    res.cookie(
      ADMIN_COOKIE,
      createSessionValue(sessionSecret),
      cookieOptions(req, { sameSite: 'strict', path: '/admin', maxAge: sessionMaxAgeMs })
    );
    res.redirect(303, '/admin');
  });

  // Everything registered on this router below this line requires the admin login.
  admin.use((req, res, next) => {
    if (isValidSession(req.cookies[ADMIN_COOKIE], sessionSecret)) return next();
    if (req.method === 'GET') return res.redirect('/admin/login');
    res.status(401).type('text').send('Log in first.');
  });

  admin.post('/logout', (req, res) => {
    res.clearCookie(ADMIN_COOKIE, cookieOptions(req, { sameSite: 'strict', path: '/admin' }));
    res.redirect(303, '/admin/login');
  });

  // Shared search for the dashboard, the history view and the CSV export.
  function findCheckouts({ q = '', status = '', openOnly }) {
    const where = [];
    const params = [];
    const today = todayLocal();
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

  admin.get('/', (req, res) => {
    const { q, status } = filters(req);
    const today = todayLocal();
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS out, COALESCE(SUM(due_date < ?), 0) AS overdue
           FROM checkouts WHERE returned_at IS NULL`
      )
      .get(today);
    res.send(views.dashboardPage({ rows: findCheckouts({ q, status, openOnly: true }), q, status, today, counts }));
  });

  admin.get('/history', (req, res) => {
    const { q, status } = filters(req);
    res.send(
      views.historyPage({ rows: findCheckouts({ q, status, openOnly: false }), q, status, today: todayLocal() })
    );
  });

  admin.post('/checkouts/:id/return', (req, res) => {
    markReturned.run(new Date().toISOString(), 'admin', Number(req.params.id));
    res.redirect(303, '/admin');
  });

  admin.get('/export.csv', (req, res) => {
    const openOnly = req.query.scope !== 'all';
    const today = todayLocal();
    const rows = findCheckouts({ openOnly });
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

  const listItems = () =>
    db
      .prepare(
        `SELECT i.*, EXISTS(SELECT 1 FROM checkouts c WHERE c.item_id = i.id AND c.returned_at IS NULL) AS is_out
           FROM items i ORDER BY i.active DESC, i.name COLLATE NOCASE`
      )
      .all();

  const itemValues = (req) => ({ name: text(req.body?.name, 100), description: text(req.body?.description, 200) });

  admin.get('/items', (req, res) => res.send(views.itemsPage({ items: listItems() })));

  admin.post('/items', (req, res) => {
    const values = itemValues(req);
    if (!values.name) {
      return res.status(400).send(views.itemsPage({ items: listItems(), values, errors: ['Enter an item name.'] }));
    }
    createItem(db, values);
    res.redirect(303, '/admin/items');
  });

  admin.get('/items/:id/edit', (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
    if (!item) return res.status(404).type('text').send('Item not found');
    res.send(views.editItemPage({ item }));
  });

  admin.post('/items/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
    if (!item) return res.status(404).type('text').send('Item not found');
    const values = { ...itemValues(req), active: req.body?.active === '1' ? 1 : 0 };
    if (!values.name) {
      return res.status(400).send(views.editItemPage({ item: { ...item, ...values }, errors: ['Enter an item name.'] }));
    }
    db.prepare('UPDATE items SET name = ?, description = ?, active = ? WHERE id = ?').run(
      values.name,
      values.description,
      values.active,
      item.id
    );
    res.redirect(303, '/admin/items');
  });

  admin.get('/qr', async (req, res) => {
    const single = req.query.item !== undefined;
    const items = single
      ? db.prepare('SELECT * FROM items WHERE id = ? AND active = 1').all(Number(req.query.item))
      : db.prepare('SELECT * FROM items WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
    const root = (baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const labels = await Promise.all(
      items.map(async (item) => ({
        name: item.name,
        svg: await QRCode.toString(`${root}/i/${item.code}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }),
      }))
    );
    res.send(views.qrSheetPage({ labels, baseUrl: root, single }));
  });

  app.use('/admin', admin);

  app.use((req, res) => {
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
