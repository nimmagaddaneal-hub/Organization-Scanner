import { randomBytes } from 'node:crypto';
import { database } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set. Admins are logged out every time the server restarts.');
}

const db = await openDb(database);
const adminSignupCode = process.env.ADMIN_SIGNUP_CODE || '';
const teacherSignupCode = process.env.TEACHER_SIGNUP_CODE || '';

for (const [name, code] of [['ADMIN_SIGNUP_CODE', adminSignupCode], ['TEACHER_SIGNUP_CODE', teacherSignupCode]]) {
  if (code && code.length < 8) {
    console.error(`${name} must be at least 8 characters.`);
    process.exit(1);
  }
}
const { admins } = await db.prepare("SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND active = 1").get();
if (admins === 0 && !adminSignupCode) {
  console.error('There is no admin account yet. Set ADMIN_SIGNUP_CODE (in .env or your host settings), start again, and sign up at /admin/signup.');
  process.exit(1);
}

const app = createApp({
  db,
  sessionSecret,
  adminSignupCode,
  teacherSignupCode,
  // Render sets RENDER_EXTERNAL_URL to the site's public address.
  baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '',
  emailDomain: process.env.SCHOOL_EMAIL_DOMAIN || '',
  trustProxy: process.env.TRUST_PROXY === '1',
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Check-out system running on http://localhost:${port}`);
  console.log(`Staff login: http://localhost:${port}/admin`);
  if (admins === 0) console.log(`No admin account yet. Create one at http://localhost:${port}/admin/signup`);
});
