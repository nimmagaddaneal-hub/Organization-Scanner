import { randomBytes } from 'node:crypto';
import { databasePath } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and choose a password.');
  process.exit(1);
}
if (adminPassword.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set. Admins are logged out every time the server restarts.');
}

const app = createApp({
  db: openDb(databasePath),
  adminPassword,
  sessionSecret,
  baseUrl: process.env.BASE_URL || '',
  emailDomain: process.env.SCHOOL_EMAIL_DOMAIN || '',
  trustProxy: process.env.TRUST_PROXY === '1',
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Check-out system running on http://localhost:${port}`);
  console.log(`Admin page: http://localhost:${port}/admin`);
});
