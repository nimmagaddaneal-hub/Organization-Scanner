import { randomBytes } from 'node:crypto';
import { database } from './config.js';
import { openDb, syncDefaultSchool } from './db.js';
import { makeDemoNotifier } from './mail.js';
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
// The first school ("Rowland Hall organization drawer") takes its codes and email domain from these settings.
await syncDefaultSchool(db, {
  adminCode: adminSignupCode,
  teacherCode: teacherSignupCode,
  emailDomain: process.env.SCHOOL_EMAIL_DOMAIN || '',
});
const { admins } = await db.prepare("SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND active = 1").get();
if (admins === 0 && !adminSignupCode) {
  console.warn('There is no admin account yet and ADMIN_SIGNUP_CODE is not set. Set it and restart, then sign up at /admin/signup.');
}

// Demo requests are emailed to the owner. They are also saved, so none is lost if the email fails.
const notifyDemo = makeDemoNotifier({
  apiKey: process.env.RESEND_API_KEY,
  to: process.env.DEMO_NOTIFY_EMAIL,
  from: process.env.MAIL_FROM,
});
if (!notifyDemo) console.warn('DEMO_NOTIFY_EMAIL and RESEND_API_KEY are not both set. Demo requests are saved but not emailed.');

const app = createApp({
  db,
  sessionSecret,
  notifyDemo: notifyDemo ?? undefined,
  // Render sets RENDER_EXTERNAL_URL to the site's public address.
  baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '',
  trustProxy: process.env.TRUST_PROXY === '1',
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Check-out system running on http://localhost:${port}`);
  console.log(`Staff login: http://localhost:${port}/admin`);
});
