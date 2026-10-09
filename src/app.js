import express from 'express';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createItem, createSchool, newSignupCode, DEFAULT_SCHOOL_ID } from './db.js';
import {
  ADMIN_COOKIE,
  parseCookies,
  safeEqual,
  createSessionValue,
  readSession,
  passwordVersion,
  temporaryPassword,
  hashPassword,
  verifyPassword,
  sessionMaxAgeMs,
  createRateLimiter,
} from './auth.js';
import * as views from './views.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETURN_COOKIE_DAYS = 180;
const PHONE_PATTERN = /^[0-9+().\-\s]{7,30}$/;

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
  notifyDemo = async () => {},
  ownerPassword = '',
  baseUrl = '',
  trustProxy = false,
}) {
  if (!sessionSecret) throw new Error('sessionSecret is required');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);

  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const demoLimiter = createRateLimiter(5, 60 * 60 * 1000);
  const ownerLimiter = createRateLimiter(6, 15 * 60 * 1000);
  // Wrong guesses when returning without the phone that checked the item out. Per item and address.
  const returnLimiter = createRateLimiter(5, 10 * 60 * 1000);
  const signupLimiter = createRateLimiter(8, 15 * 60 * 1000);
  // Limits password guesses on the settings page, per account.
  const accountLimiter = createRateLimiter(8, 15 * 60 * 1000);

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
  // 100 kb leaves room for pasting a spreadsheet of items.
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Block form posts that come from another website.
  app.use((req, res, next) => {
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

  const cookieOptions = (req, extra) => ({ httpOnly: true, secure: req.secure, ...extra });

  const findItem = db.prepare(
    `SELECT i.*, s.name AS school_name, s.email_domain AS school_email_domain
       FROM items i LEFT JOIN schools s ON s.id = i.school_id
      WHERE i.code = ? AND i.active = 1`
  );
  const findOpenCheckout = db.prepare('SELECT * FROM checkouts WHERE item_id = ? AND returned_at IS NULL');
  const markReturned = db.prepare(
    'UPDATE checkouts SET returned_at = ?, returned_by = ?, return_notes = ? WHERE id = ? AND returned_at IS NULL'
  );
  const RETURN_NOTES_MAX = 300;
  // One extension of up to this many days, by the student who has the item.
  const EXTENSION_DAYS = 7;
  const addDays = (day, days) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  // At check-out the phone saves a private cookie for that item, so a later scan can offer "Return this item".
  const returnCookieName = (item) => `rt_${item.code}`;
  const holdsItem = (req, item, checkout) =>
    Boolean(checkout) &&
    Boolean(req.cookies[returnCookieName(item)]) &&
    safeEqual(req.cookies[returnCookieName(item)], checkout.return_token);

  // ---------- Demo requests from other schools ----------

  const homePage = (req, extra = {}) => views.homePage(extra);

  app.get('/', async (req, res) => res.send(homePage(req, { demoSent: req.query.demo === 'sent' })));

  app.get('/privacy', async (req, res) => res.send(views.privacyPage({})));

  // What is available at a school right now. No names, only the item and whether it is out.
  app.get('/available/:token', async (req, res) => {
    const token = String(req.params.token);
    const school = /^[A-Za-z0-9_-]{10,40}$/.test(token)
      ? await db.prepare('SELECT id, name FROM schools WHERE list_code = ?').get(token)
      : null;
    if (!school) {
      return res.status(404).send(views.messagePage({ title: 'Page not found', message: 'This link does not work. Ask your teacher for a new one.', status: 'warning' }));
    }
    const items = await db
      .prepare(
        `SELECT i.name, i.description, i.category,
                (SELECT c.due_date FROM checkouts c WHERE c.item_id = i.id AND c.returned_at IS NULL) AS due_date
           FROM items i WHERE i.school_id = ? AND i.active = 1
          ORDER BY i.category COLLATE NOCASE, i.name COLLATE NOCASE`
      )
      .all(school.id);
    res.send(views.availablePage({ school, items }));
  });

  app.post('/demo', async (req, res) => {
    const values = {
      name: text(req.body?.name, 100),
      email: text(req.body?.email, 254).toLowerCase(),
      school: text(req.body?.school, 150),
      role: text(req.body?.role, 100),
      message: text(req.body?.message, 1000),
    };
    // A hidden field that people never see. Bots fill it in. They get a fake success and nothing is saved.
    if (text(req.body?.website, 200)) return res.redirect(303, '/?demo=sent#demo');

    const key = `demo:${req.ip}`;
    if (demoLimiter.isBlocked(key)) {
      return res.status(429).send(homePage(req, { demo: { values, errors: ['Too many requests. Try again later.'] } }));
    }
    const errors = [];
    if (!values.name) errors.push('Enter your name.');
    if (!EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    if (!values.school) errors.push('Enter your school or organization.');
    if (errors.length) return res.status(400).send(homePage(req, { demo: { values, errors } }));

    demoLimiter.recordFailure(key);
    await db
      .prepare('INSERT INTO demo_requests (name, email, school, role, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(values.name, values.email, values.school, values.role, values.message, new Date().toISOString());
    // The request is already saved. A failed email must not make the visitor's request fail.
    try {
      await notifyDemo(values);
    } catch (error) {
      console.error('Could not email a demo request:', error.message);
    }
    res.redirect(303, '/?demo=sent#demo');
  });

  // ---------- Items: scan, check out, return ----------

  // For handheld barcode scanners and typed codes: the barcode holds the item code.
  app.get('/find', async (req, res) => {
    const code = text(req.query.code, 40).toLowerCase();
    if (!/^[a-z0-9]+$/.test(code)) return res.redirect('/');
    res.redirect(`/i/${code}`);
  });

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // The scan page uses a small open-source QR reader (jsQR) on phones that have no built-in one.
  app.get('/scan', async (req, res) => res.send(views.scanPage()));
  app.get('/vendor/jsQR.js', (req, res) =>
    res.sendFile(fileURLToPath(new URL('../node_modules/jsqr/dist/jsQR.js', import.meta.url)))
  );

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
    views.checkoutFormPage({ item: req.item, today: todayLocal(), now: new Date().toISOString(), ...extra });

  app.get('/i/:code', async (req, res) => {
    const { item } = req;
    const checkout = await findOpenCheckout.get(item.id);
    if (!checkout) return res.send(formPage(req));
    if (holdsItem(req, item, checkout)) {
      return res.send(
        views.ownCheckoutPage({
          item,
          checkout,
          justCheckedOut: req.query.done === '1',
          extended: req.query.extended === '1',
          today: todayLocal(),
          maxExtension: addDays(checkout.due_date > todayLocal() ? checkout.due_date : todayLocal(), EXTENSION_DAYS),
        })
      );
    }
    res.send(views.unavailablePage({ item }));
  });

  app.post('/i/:code/checkout', async (req, res) => {
    const { item } = req;
    const values = {
      student_name: text(req.body?.student_name, 100),
      student_id: text(req.body?.student_id, 20),
      email: text(req.body?.email, 254).toLowerCase(),
      phone: text(req.body?.phone, 30),
      due_date: text(req.body?.due_date, 10),
      purpose: text(req.body?.purpose, 500),
    };

    const errors = [];
    const domain = item.school_email_domain;
    if (!values.student_name) errors.push('Enter your full name.');
    if (!values.student_id) errors.push('Enter your student ID number (lunch number).');
    else if (!/^[A-Za-z0-9-]+$/.test(values.student_id)) {
      errors.push('Student ID can only contain letters, numbers and dashes.');
    }
    if (!values.email) errors.push('Enter your school email.');
    else if (!EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    else if (domain && !values.email.endsWith(`@${domain}`)) {
      errors.push(`Use your school email ending in @${domain}.`);
    }
    if (values.phone && !PHONE_PATTERN.test(values.phone)) errors.push('Enter a valid phone number, or leave it empty.');
    if (!values.due_date) errors.push('Choose an expected return date.');
    else if (!isRealDate(values.due_date)) errors.push('Enter a valid return date.');
    else if (values.due_date < todayLocal()) errors.push('The return date cannot be in the past.');

    if (errors.length) return res.status(400).send(formPage(req, { values, errors }));

    const returnToken = randomBytes(24).toString('hex');
    try {
      await db
        .prepare(
          `INSERT INTO checkouts
             (item_id, student_name, student_id, email, phone, purpose, checked_out_at, due_date, return_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
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
      if (String(error.message).includes('UNIQUE')) return res.status(409).send(views.unavailablePage({ item }));
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

  // One extension, by the phone that checked the item out. Staff can change a date any time from the dashboard.
  app.post('/i/:code/extend', async (req, res) => {
    const { item } = req;
    const checkout = await findOpenCheckout.get(item.id);
    if (!checkout || !holdsItem(req, item, checkout)) return res.redirect(303, `/i/${item.code}`);
    const today = todayLocal();
    const latest = addDays(checkout.due_date > today ? checkout.due_date : today, EXTENSION_DAYS);
    const newDate = text(req.body?.due_date, 10);
    const problem = checkout.extended
      ? 'This check-out was already extended once. Ask a teacher if you need more time.'
      : !isRealDate(newDate)
        ? 'Choose a valid date.'
        : newDate <= checkout.due_date || newDate < today
          ? 'Choose a date after the current return date.'
          : newDate > latest
            ? `You can extend by up to ${EXTENSION_DAYS} days.`
            : null;
    if (problem) {
      return res.status(400).send(
        views.ownCheckoutPage({ item, checkout, today, maxExtension: latest, extensionError: problem })
      );
    }
    await db
      .prepare('UPDATE checkouts SET due_date = ?, original_due_date = COALESCE(original_due_date, due_date), extended = 1 WHERE id = ? AND returned_at IS NULL')
      .run(newDate, checkout.id);
    res.redirect(303, `/i/${item.code}?extended=1`);
  });

  app.post('/i/:code/return', async (req, res) => {
    const { item } = req;
    const checkout = await findOpenCheckout.get(item.id);
    if (!checkout) return res.redirect(303, `/i/${item.code}`);

    const limiterKey = `${req.ip}:${item.id}`;
    let allowed = holdsItem(req, item, checkout);

    if (!allowed) {
      if (returnLimiter.isBlocked(limiterKey)) {
        return res
          .status(429)
          .send(views.unavailablePage({ item, errors: ['Too many attempts. Wait a few minutes or ask an officer for help.'] }));
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

    await markReturned.run(new Date().toISOString(), 'student', text(req.body?.return_notes, RETURN_NOTES_MAX), checkout.id);
    returnLimiter.clear(limiterKey);
    res.clearCookie(returnCookieName(item), cookieOptions(req, { sameSite: 'lax', path: `/i/${item.code}` }));
    res.send(views.returnedPage({ item }));
  });

  // ---------- Staff routes (admins and teachers) ----------

  const admin = express.Router();

  const findUser = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.school_id, u.must_change, u.password_hash, s.name AS school_name
       FROM users u JOIN schools s ON s.id = u.school_id
      WHERE u.id = ? AND u.active = 1`
  );
  // The account is looked up on every request, so deactivating someone takes effect at once.
  // A session only works for the password it was made with.
  const currentUser = async (req) => {
    const session = readSession(req.cookies[ADMIN_COOKIE], sessionSecret);
    const row = session ? await findUser.get(session.id) : null;
    if (!row || session.version !== passwordVersion(row.password_hash)) return null;
    const { password_hash: _hash, ...user } = row;
    return user;
  };
  const startSession = (req, res, userId, passwordHash) =>
    res.cookie(
      ADMIN_COOKIE,
      createSessionValue(userId, sessionSecret, undefined, passwordVersion(passwordHash)),
      cookieOptions(req, { sameSite: 'strict', path: '/admin', maxAge: sessionMaxAgeMs })
    );
  // Checked when the email is unknown, so a wrong email takes as long as a wrong password.
  const dummyHash = hashPassword(randomBytes(16).toString('hex'));

  admin.get('/login', async (req, res) => {
    if (await currentUser(req)) return res.redirect('/admin');
    res.send(views.loginPage());
  });

  admin.post('/login', async (req, res) => {
    const email = text(req.body?.email, 254).toLowerCase();
    if (loginLimiter.isBlocked(req.ip)) {
      return res.status(429).send(views.loginPage({ email, error: 'Too many attempts. Try again in 15 minutes.' }));
    }
    const account = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const passwordOk = verifyPassword(req.body?.password ?? '', account ? account.password_hash : dummyHash);
    if (!account || !passwordOk || !account.active) {
      loginLimiter.recordFailure(req.ip);
      return res.status(401).send(views.loginPage({ email, error: 'Wrong email or password.' }));
    }
    loginLimiter.clear(req.ip);
    startSession(req, res, account.id, account.password_hash);
    res.redirect(303, '/admin');
  });

  admin.get('/signup', async (req, res) => {
    res.send(views.signupPage());
  });

  admin.post('/signup', async (req, res) => {
    const values = { name: text(req.body?.name, 100), email: text(req.body?.email, 254).toLowerCase() };
    const password = String(req.body?.password ?? '');
    const signupCode = String(req.body?.signup_code ?? '');
    const fail = (status, errors) => res.status(status).send(views.signupPage({ values, errors }));

    if (signupLimiter.isBlocked(req.ip)) return fail(429, ['Too many attempts. Try again in 15 minutes.']);

    // The code decides the school and the role. Without a valid code nobody gets an account.
    let role = null;
    let schoolId = null;
    for (const school of await db.prepare('SELECT id, admin_code, teacher_code FROM schools').all()) {
      if (school.admin_code && safeEqual(signupCode, school.admin_code)) [role, schoolId] = ['admin', school.id];
      else if (school.teacher_code && safeEqual(signupCode, school.teacher_code)) [role, schoolId] = ['teacher', school.id];
    }

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
    const passwordHash = hashPassword(password);
    try {
      const result = await db
        .prepare('INSERT INTO users (name, email, password_hash, role, school_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(values.name, values.email, passwordHash, role, schoolId, new Date().toISOString());
      userId = result.lastInsertRowid;
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return fail(400, ['An account with this email already exists. Log in instead.']);
      throw error;
    }
    startSession(req, res, userId, passwordHash);
    res.redirect(303, role === 'admin' ? '/admin' : '/admin/items');
  });

  // Everything registered on this router below this line requires a staff login.
  admin.use(async (req, res, next) => {
    req.user = await currentUser(req);
    // Someone with a temporary password must choose their own before doing anything else.
    if (req.user?.must_change && !['/settings/new-password', '/logout'].includes(req.path)) {
      return res.redirect(303, '/admin/settings/new-password');
    }
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

  // ---------- Own account: settings ----------

  const passwordMatches = async (user, password) => {
    const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    return Boolean(row) && verifyPassword(String(password ?? ''), row.password_hash);
  };

  // Admins cannot be removed while they are the only active admin, so someone can always manage the site.
  const isLastAdmin = async (user) =>
    user.role === 'admin' &&
    (
      await db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id != ? AND school_id = ?")
        .get(user.id, user.school_id)
    ).count === 0;

  // Items of a removed account stay, as organization items. Check-out history is kept.
  async function removeAccount(userId) {
    await db.prepare('UPDATE items SET owner_id = NULL WHERE owner_id = ?').run(userId);
    await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  admin.get('/settings', async (req, res) => {
    res.send(views.settingsPage({ user: req.user, notice: text(req.query.saved, 20) }));
  });

  admin.post('/settings/name', async (req, res) => {
    const name = text(req.body?.name, 100);
    if (!name) {
      return res.status(400).send(views.settingsPage({ user: req.user, errors: { name: ['Enter your full name.'] }, values: { name } }));
    }
    await db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    res.redirect(303, '/admin/settings?saved=name');
  });

  admin.post('/settings/password', async (req, res) => {
    const fail = (status, message) =>
      res.status(status).send(views.settingsPage({ user: req.user, errors: { password: [message] } }));
    const limiterKey = `user:${req.user.id}`;
    if (accountLimiter.isBlocked(limiterKey)) return fail(429, 'Too many attempts. Try again in 15 minutes.');

    const newPassword = String(req.body?.new_password ?? '');
    if (!(await passwordMatches(req.user, req.body?.current_password))) {
      accountLimiter.recordFailure(limiterKey);
      return fail(403, 'Your current password is not correct.');
    }
    if (newPassword.length < 10) return fail(400, 'Choose a new password of 10 characters or more.');
    if (newPassword.length > 200) return fail(400, 'Choose a new password of 200 characters or fewer.');
    if (newPassword !== String(req.body?.confirm_password ?? '')) return fail(400, 'The new passwords do not match.');

    accountLimiter.clear(limiterKey);
    // The new password signs out every other device, so the cookie is issued again here.
    const newHash = hashPassword(newPassword);
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(newHash, req.user.id);
    startSession(req, res, req.user.id, newHash);
    res.redirect(303, '/admin/settings?saved=password');
  });

  // Choosing a new password after someone reset it for you.
  admin.get('/settings/new-password', async (req, res) => {
    res.send(views.newPasswordPage({ user: req.user, action: '/admin/settings/new-password', minLength: 10 }));
  });

  admin.post('/settings/new-password', async (req, res) => {
    const password = String(req.body?.password ?? '');
    const fail = (errors) =>
      res.status(400).send(views.newPasswordPage({ user: req.user, action: '/admin/settings/new-password', minLength: 10, errors }));
    if (password.length < 10) return fail(['Choose a password of 10 characters or more.']);
    if (password.length > 200) return fail(['Choose a password of 200 characters or fewer.']);
    if (password !== String(req.body?.confirm_password ?? '')) return fail(['The passwords do not match.']);
    const hash = hashPassword(password);
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(hash, req.user.id);
    startSession(req, res, req.user.id, hash);
    res.redirect(303, '/admin');
  });

  admin.get('/settings/delete', async (req, res) => {
    res.send(views.deleteAccountPage({ user: req.user, lastAdmin: await isLastAdmin(req.user) }));
  });

  admin.post('/settings/delete', async (req, res) => {
    if (await isLastAdmin(req.user)) {
      return res.status(409).send(views.deleteAccountPage({ user: req.user, lastAdmin: true }));
    }
    const limiterKey = `user:${req.user.id}`;
    if (accountLimiter.isBlocked(limiterKey)) {
      return res.status(429).send(views.deleteAccountPage({ user: req.user, errors: ['Too many attempts. Try again in 15 minutes.'] }));
    }
    if (!(await passwordMatches(req.user, req.body?.password))) {
      accountLimiter.recordFailure(limiterKey);
      return res.status(403).send(views.deleteAccountPage({ user: req.user, errors: ['That password is not correct.'] }));
    }
    accountLimiter.clear(limiterKey);
    await removeAccount(req.user.id);
    res.clearCookie(ADMIN_COOKIE, cookieOptions(req, { sameSite: 'strict', path: '/admin' }));
    res.redirect(303, '/admin/login');
  });

  // Everyone sees only their own school. Teachers see only the items they listed and those items' check-outs;
  // admins see everything in their school. Every query on items or check-outs below goes through this.
  function ownerScope(user, where, params) {
    where.push('i.school_id = ?');
    params.push(user.school_id);
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
    await markReturned.run(new Date().toISOString(), req.user.role, text(req.body?.return_notes, RETURN_NOTES_MAX), checkout.id);
    res.redirect(303, '/admin');
  });

  admin.post('/checkouts/:id/due', async (req, res) => {
    const where = ['c.id = ?', 'c.returned_at IS NULL'];
    const params = [Number(req.params.id)];
    ownerScope(req.user, where, params);
    const checkout = await db
      .prepare(`SELECT c.id FROM checkouts c JOIN items i ON i.id = c.item_id WHERE ${where.join(' AND ')}`)
      .get(...params);
    if (!checkout) return res.status(404).type('text').send('Check-out not found');
    const newDate = text(req.body?.due_date, 10);
    if (isRealDate(newDate)) {
      await db
        .prepare('UPDATE checkouts SET due_date = ?, original_due_date = COALESCE(original_due_date, due_date), extended = 1 WHERE id = ?')
        .run(newDate, checkout.id);
    }
    res.redirect(303, '/admin');
  });

  admin.get('/export.csv', async (req, res) => {
    const openOnly = req.query.scope !== 'all';
    const today = todayLocal();
    const rows = await findCheckouts(req.user, { openOnly });
    const header = [
      'Item', 'Student name', 'Student ID', 'Email', 'Phone', 'Purpose',
      'Checked out', 'Due date', 'Original due date', 'Returned', 'Returned by', 'Return notes', 'Status',
    ];
    const lines = rows.map((row) =>
      [
        row.item_name, row.student_name, row.student_id, row.email, row.phone, row.purpose,
        row.checked_out_at, row.due_date, row.original_due_date, row.returned_at, row.returned_by, row.return_notes,
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
          ORDER BY i.active DESC, i.category COLLATE NOCASE, i.name COLLATE NOCASE`
      )
      .all(...params);
  }

  const itemValues = (req) => ({
    name: text(req.body?.name, 100),
    description: text(req.body?.description, 200),
    category: text(req.body?.category, 40),
  });

  const categoriesOf = async (user) => {
    const where = [];
    const params = [];
    ownerScope(user, where, params);
    where.push("i.category != ''");
    return (
      await db.prepare(`SELECT DISTINCT i.category FROM items i WHERE ${where.join(' AND ')} ORDER BY i.category COLLATE NOCASE`).all(...params)
    ).map((row) => row.category);
  };

  const availabilityUrl = async (req) => {
    if (req.user.role !== 'admin') return undefined;
    const school = await db.prepare('SELECT list_code FROM schools WHERE id = ?').get(req.user.school_id);
    if (!school?.list_code) return null;
    return `${(baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/available/${school.list_code}`;
  };

  const itemsView = async (req, extra = {}) =>
    views.itemsPage({
      user: req.user,
      items: await findItems(req.user),
      categories: await categoriesOf(req.user),
      availabilityUrl: await availabilityUrl(req),
      notice: text(req.query.saved, 20),
      imported: Number(req.query.imported) || 0,
      skipped: Number(req.query.skipped) || 0,
      ...extra,
    });

  admin.get('/items', async (req, res) => res.send(await itemsView(req)));

  // Paste or upload a spreadsheet: name, description, category (a header row is fine).
  const IMPORT_MAX_ROWS = 100;
  function parseCsv(textValue) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(textValue).replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',' || char === '\t') {
        row.push(cell);
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += char;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
  }

  admin.post('/items/import', async (req, res) => {
    let rows = parseCsv(req.body?.csv ?? '');
    if (rows.length && ['name', 'item', 'item name'].includes(String(rows[0][0]).trim().toLowerCase())) rows = rows.slice(1);
    let imported = 0;
    let skipped = 0;
    for (const cells of rows) {
      if (imported >= IMPORT_MAX_ROWS) {
        skipped += 1;
        continue;
      }
      const name = text(cells[0], 100);
      if (!name) {
        skipped += 1;
        continue;
      }
      await createItem(db, {
        name,
        description: text(cells[1], 200),
        category: text(cells[2], 40),
        ownerId: req.user.id,
        schoolId: req.user.school_id,
      });
      imported += 1;
    }
    res.redirect(303, `/admin/items?saved=imported&imported=${imported}&skipped=${skipped}`);
  });

  // A public "what is available" page for the school, behind a link only the admin can make.
  admin.post('/availability', requireAdmin, async (req, res) => {
    const action = req.body?.action;
    const code = action === 'off' ? null : randomBytes(12).toString('base64url');
    await db.prepare('UPDATE schools SET list_code = ? WHERE id = ?').run(code, req.user.school_id);
    res.redirect(303, '/admin/items?saved=link');
  });

  // Listing an item makes its code at once and goes straight to the printable label.
  admin.post('/items', async (req, res) => {
    const values = itemValues(req);
    if (!values.name) {
      return res
        .status(400)
        .send(await itemsView(req, { values, errors: ['Enter an item name.'] }));
    }
    const itemId = await createItem(db, { ...values, ownerId: req.user.id, schoolId: req.user.school_id });
    res.redirect(303, `/admin/qr?item=${itemId}&listed=1`);
  });

  admin.get('/items/:id/edit', async (req, res) => {
    const [item] = await findItems(req.user, { id: Number(req.params.id) });
    if (!item) return res.status(404).type('text').send('Item not found');
    res.send(views.editItemPage({ user: req.user, item, categories: await categoriesOf(req.user) }));
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
    await db.prepare('UPDATE items SET name = ?, description = ?, category = ?, active = ? WHERE id = ?').run(
      values.name,
      values.description,
      values.category,
      values.active,
      item.id
    );
    res.redirect(303, '/admin/items');
  });

  // Deleting is permanent, so it goes through a confirmation page first.
  const historyCount = async (itemId) =>
    (await db.prepare('SELECT COUNT(*) AS count FROM checkouts WHERE item_id = ?').get(itemId)).count;

  admin.get('/items/:id/delete', async (req, res) => {
    const [item] = await findItems(req.user, { id: Number(req.params.id) });
    if (!item) return res.status(404).type('text').send('Item not found');
    res.send(views.deleteItemPage({ user: req.user, item, historyCount: await historyCount(item.id) }));
  });

  admin.post('/items/:id/delete', async (req, res) => {
    const [item] = await findItems(req.user, { id: Number(req.params.id) });
    if (!item) return res.status(404).type('text').send('Item not found');
    // An item a student still holds cannot be deleted. Mark it returned first.
    if (item.is_out) {
      return res
        .status(409)
        .send(views.deleteItemPage({ user: req.user, item, historyCount: await historyCount(item.id) }));
    }
    await db.prepare('DELETE FROM checkouts WHERE item_id = ?').run(item.id);
    await db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
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
    const size = ['large', 'medium', 'small', 'tiny'].includes(req.query.size) ? req.query.size : 'medium';
    res.send(
      views.qrSheetPage({
        user: req.user,
        labels,
        baseUrl: root,
        single,
        size,
        itemId: single ? Number(req.query.item) : null,
        justListed: req.query.listed === '1' && labels.length > 0,
      })
    );
  });

  admin.get('/people', requireAdmin, async (req, res) => {
    const people = await db
      .prepare('SELECT id, name, email, role, active, created_at FROM users WHERE school_id = ? ORDER BY role, name COLLATE NOCASE')
      .all(req.user.school_id);
    const school = await db.prepare('SELECT name, admin_code, teacher_code FROM schools WHERE id = ?').get(req.user.school_id);
    res.send(views.peoplePage({ user: req.user, people, school }));
  });

  admin.get('/people/:id/delete', requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    if (personId === req.user.id) return res.redirect('/admin/settings/delete');
    const person = await db.prepare('SELECT id, name, email, role FROM users WHERE id = ? AND school_id = ?').get(personId, req.user.school_id);
    if (!person) return res.status(404).type('text').send('Account not found');
    const { count } = await db.prepare('SELECT COUNT(*) AS count FROM items WHERE owner_id = ?').get(person.id);
    res.send(views.deletePersonPage({ user: req.user, person, itemCount: count }));
  });

  admin.post('/people/:id/delete', requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    // Your own account is removed from Settings, which asks for your password.
    if (personId === req.user.id) return res.redirect(303, '/admin/settings/delete');
    const person = await db.prepare('SELECT id FROM users WHERE id = ? AND school_id = ?').get(personId, req.user.school_id);
    if (!person) return res.status(404).type('text').send('Account not found');
    await removeAccount(person.id);
    res.redirect(303, '/admin/people');
  });

  // Reset a password without email: a temporary one is shown once, to hand over in person.
  // The person must choose their own at the next login, and every old login stops working.
  admin.post('/people/:id/reset-password', requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    if (personId === req.user.id) return res.redirect(303, '/admin/settings');
    const person = await db
      .prepare('SELECT id, name, email FROM users WHERE id = ? AND school_id = ?')
      .get(personId, req.user.school_id);
    if (!person) return res.status(404).type('text').send('Account not found');
    const temporary = temporaryPassword();
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(temporary), person.id);
    res.send(views.tempPasswordPage({ user: req.user, person, temporary, back: '/admin/people', backLabel: 'People' }));
  });

  admin.post('/people/:id/active', requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    // Admins cannot deactivate themselves, so there is always one working admin.
    if (personId === req.user.id) return res.status(400).type('text').send('You cannot deactivate your own account.');
    await db
      .prepare('UPDATE users SET active = ? WHERE id = ? AND school_id = ?')
      .run(req.body?.active === '1' ? 1 : 0, personId, req.user.school_id);
    res.redirect(303, '/admin/people');
  });

  // ---------- Owner: schools, demo requests, accounts ----------
  // For the person who runs the site. Not tied to any school. Off unless OWNER_PASSWORD is set.

  const OWNER_COOKIE = 'owner_session';
  const ownerSecret = `${sessionSecret}:owner`;
  const owner = express.Router();

  owner.use(async (req, res, next) => {
    if (!ownerPassword) return res.status(404).send(views.messagePage({ title: 'Page not found', message: 'This page does not exist.', status: 'warning' }));
    req.isOwner = Boolean(readSession(req.cookies[OWNER_COOKIE], ownerSecret));
    next();
  });

  owner.get('/login', async (req, res) => {
    if (req.isOwner) return res.redirect('/owner');
    res.send(views.ownerLoginPage());
  });

  owner.post('/login', async (req, res) => {
    if (ownerLimiter.isBlocked(req.ip)) {
      return res.status(429).send(views.ownerLoginPage({ error: 'Too many attempts. Try again in 15 minutes.' }));
    }
    if (!safeEqual(req.body?.password ?? '', ownerPassword)) {
      ownerLimiter.recordFailure(req.ip);
      return res.status(401).send(views.ownerLoginPage({ error: 'Wrong password.' }));
    }
    ownerLimiter.clear(req.ip);
    res.cookie(
      OWNER_COOKIE,
      createSessionValue(1, ownerSecret),
      cookieOptions(req, { sameSite: 'strict', path: '/owner', maxAge: sessionMaxAgeMs })
    );
    res.redirect(303, '/owner');
  });

  // Everything below needs the owner login.
  owner.use(async (req, res, next) => {
    if (req.isOwner) return next();
    if (req.method === 'GET') return res.redirect('/owner/login');
    res.status(401).type('text').send('Log in first.');
  });

  owner.post('/logout', async (req, res) => {
    res.clearCookie(OWNER_COOKIE, cookieOptions(req, { sameSite: 'strict', path: '/owner' }));
    res.redirect(303, '/owner/login');
  });

  owner.get('/', async (req, res) => {
    const schools = await db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id) AS staff,
                (SELECT COUNT(*) FROM items i WHERE i.school_id = s.id) AS items,
                (SELECT COUNT(*) FROM checkouts c JOIN items i ON i.id = c.item_id WHERE i.school_id = s.id AND c.returned_at IS NULL) AS open
           FROM schools s ORDER BY s.id`
      )
      .all();
    const { count } = await db.prepare("SELECT COUNT(*) AS count FROM demo_requests WHERE status = 'new'").get();
    res.send(views.ownerSchoolsPage({ schools, newDemos: count, defaultId: DEFAULT_SCHOOL_ID, notice: text(req.query.saved, 20) }));
  });

  owner.post('/schools', async (req, res) => {
    const name = text(req.body?.name, 120);
    const domain = text(req.body?.email_domain, 100).toLowerCase().replace(/^@/, '');
    if (!name) return res.redirect(303, '/owner');
    await createSchool(db, { name, emailDomain: domain || null });
    res.redirect(303, '/owner?saved=added');
  });

  owner.post('/schools/:id', async (req, res) => {
    const id = Number(req.params.id);
    const name = text(req.body?.name, 120);
    if (!name) return res.redirect(303, '/owner');
    await db.prepare('UPDATE schools SET name = ? WHERE id = ?').run(name, id);
    // The first school's email domain comes from SCHOOL_EMAIL_DOMAIN in the settings.
    if (id !== DEFAULT_SCHOOL_ID) {
      const domain = text(req.body?.email_domain, 100).toLowerCase().replace(/^@/, '');
      await db.prepare('UPDATE schools SET email_domain = ? WHERE id = ?').run(domain || null, id);
    }
    res.redirect(303, '/owner?saved=updated');
  });

  // New sign-up codes: the old ones stop working. The first school's codes come from the settings.
  owner.post('/schools/:id/codes', async (req, res) => {
    const id = Number(req.params.id);
    if (id === DEFAULT_SCHOOL_ID) return res.redirect(303, '/owner');
    await db.prepare('UPDATE schools SET admin_code = ?, teacher_code = ? WHERE id = ?').run(newSignupCode(), newSignupCode(), id);
    res.redirect(303, '/owner?saved=codes');
  });

  owner.get('/demos', async (req, res) => {
    const requests = await db.prepare("SELECT * FROM demo_requests ORDER BY status = 'contacted', created_at DESC").all();
    res.send(views.ownerDemosPage({ requests }));
  });

  owner.post('/demos/:id/status', async (req, res) => {
    const status = req.body?.status === 'contacted' ? 'contacted' : 'new';
    await db.prepare('UPDATE demo_requests SET status = ? WHERE id = ?').run(status, Number(req.params.id));
    res.redirect(303, '/owner/demos');
  });

  owner.post('/demos/:id/delete', async (req, res) => {
    await db.prepare('DELETE FROM demo_requests WHERE id = ?').run(Number(req.params.id));
    res.redirect(303, '/owner/demos');
  });

  // Find a staff account, to help with a lost password.
  owner.get('/accounts', async (req, res) => {
    const q = text(req.query.q, 100);
    let staff = [];
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      staff = await db
        .prepare(
          `SELECT u.id, u.name, u.email, u.role, u.active, s.name AS school_name
             FROM users u JOIN schools s ON s.id = u.school_id
            WHERE u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' ORDER BY u.name COLLATE NOCASE LIMIT 50`
        )
        .all(like, like);
    }
    res.send(views.ownerAccountsPage({ q, staff, notice: text(req.query.saved, 20) }));
  });

  owner.post('/accounts/staff/:id/reset-password', async (req, res) => {
    const person = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(Number(req.params.id));
    if (!person) return res.status(404).type('text').send('Account not found');
    const temporary = temporaryPassword();
    await db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(temporary), person.id);
    res.send(views.tempPasswordPage({ owner: true, person, temporary, back: '/owner/accounts', backLabel: 'accounts' }));
  });

  // Erase one student's details from every check-out, matched by their email or student ID.
  const studentMatch = (who) => ({ who: text(who, 254).toLowerCase() });
  owner.get('/students/erase', async (req, res) => {
    const { who } = studentMatch(req.query.who);
    if (!who) return res.redirect('/owner/accounts');
    const found = await db
      .prepare('SELECT COUNT(*) AS count FROM checkouts WHERE lower(email) = ? OR lower(student_id) = ?')
      .get(who, who);
    const accounts = await db.prepare('SELECT COUNT(*) AS count FROM students WHERE lower(email) = ? OR lower(student_id) = ?').get(who, who);
    res.send(
      views.ownerEraseStudentPage({ who, checkouts: found.count, accounts: accounts.count })
    );
  });

  owner.post('/students/erase', async (req, res) => {
    const { who } = studentMatch(req.body?.who);
    if (!who) return res.redirect(303, '/owner/accounts');
    await db
      .prepare("UPDATE checkouts SET student_name = '(erased)', student_id = '', email = '', phone = '', purpose = '', student_account_id = NULL WHERE lower(email) = ? OR lower(student_id) = ?")
      .run(who, who);
    // Student accounts from the time when they existed.
    await db.prepare('DELETE FROM students WHERE lower(email) = ? OR lower(student_id) = ?').run(who, who);
    res.redirect(303, '/owner/accounts?saved=erased');
  });

  owner.get('/accounts/staff/:id/delete', async (req, res) => {
    const person = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(Number(req.params.id));
    if (!person) return res.status(404).type('text').send('Account not found');
    res.send(
      views.ownerConfirmPage({
        title: `Delete ${person.name}`,
        message: `Deletes the staff account (${person.email}). Their items stay with their school as organization items, and check-out history is kept. This cannot be undone.`,
        action: `/owner/accounts/staff/${person.id}/delete`,
        button: 'Delete account for good',
      })
    );
  });

  owner.post('/accounts/staff/:id/delete', async (req, res) => {
    await removeAccount(Number(req.params.id));
    res.redirect(303, '/owner/accounts?saved=deleted');
  });

  app.use('/owner', owner);

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
