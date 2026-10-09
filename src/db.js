import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// The first school. Accounts and items made before schools existed belong to it.
export const DEFAULT_SCHOOL_ID = 1;
export const DEFAULT_SCHOOL_NAME = 'Rowland Hall organization drawer';

const SCHEMA = `
-- Each school has its own staff, items and check-outs. Admins and teachers see only their own school.
-- The sign-up codes decide which school (and role) a new staff account joins.
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  admin_code    TEXT,
  teacher_code  TEXT,
  email_domain  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- Staff accounts. role is 'admin' (sees everything) or 'teacher' (sees only their own items).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- Student accounts. A student signs up once, then checks items out under that account.
CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- People waiting for an item that is checked out. Staff email them when it is back.
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS waitlist_by_item ON waitlist(item_id);

-- Counts of recent attempts (wrong passwords, form submissions), kept so limits survive a restart.
CREATE TABLE IF NOT EXISTS rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Schools that asked for a demo from the home page.
CREATE TABLE IF NOT EXISTS demo_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  school     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkouts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(id),
  student_name   TEXT NOT NULL,
  student_id     TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT NOT NULL DEFAULT '',
  purpose        TEXT NOT NULL DEFAULT '',
  checked_out_at TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  returned_at    TEXT,
  returned_by    TEXT,
  return_token   TEXT NOT NULL
);

-- An item can have only one open check-out. The database enforces it,
-- so two students submitting at the same moment cannot both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_checkout_per_item
  ON checkouts(item_id) WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS checkouts_by_item ON checkouts(item_id);
`;

// url is either a local file ("file:./data/checkout.db") or a hosted Turso database ("libsql://...").
// Both speak SQLite, so the rest of the code does not care which one it is.
export async function openDb({ url, authToken }) {
  if (url.startsWith('file:')) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  const client = createClient({ url, authToken: authToken || undefined });

  const rowsOf = (result) =>
    result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));

  const db = {
    // Same shape as a prepared statement, but every call returns a promise.
    prepare(sql) {
      return {
        all: async (...args) => rowsOf(await client.execute({ sql, args })),
        get: async (...args) => rowsOf(await client.execute({ sql, args }))[0],
        run: async (...args) => {
          const result = await client.execute({ sql, args });
          return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
        },
      };
    },
    close: () => client.close(),
  };

  if (url.startsWith('file:')) await client.execute('PRAGMA journal_mode = WAL');
  await client.executeMultiple(SCHEMA);
  // Databases made before staff accounts existed have no owner column on items.
  const itemColumns = (await db.prepare('PRAGMA table_info(items)').all()).map((column) => column.name);
  if (!itemColumns.includes('owner_id')) {
    await client.execute('ALTER TABLE items ADD COLUMN owner_id INTEGER REFERENCES users(id)');
  }
  // Databases made before schools existed: everything belongs to the first school.
  await client.execute({
    sql: 'INSERT OR IGNORE INTO schools (id, name, created_at) VALUES (?, ?, ?)',
    args: [DEFAULT_SCHOOL_ID, DEFAULT_SCHOOL_NAME, new Date().toISOString()],
  });
  for (const table of ['users', 'items']) {
    const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).map((column) => column.name);
    if (!columns.includes('school_id')) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN school_id INTEGER REFERENCES schools(id)`);
    }
    await client.execute({ sql: `UPDATE ${table} SET school_id = ? WHERE school_id IS NULL`, args: [DEFAULT_SCHOOL_ID] });
  }

  // Item categories, and an optional public "what is available" link for each school.
  const itemColumnsNow = (await db.prepare('PRAGMA table_info(items)').all()).map((column) => column.name);
  if (!itemColumnsNow.includes('category')) {
    await client.execute("ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  }
  const schoolColumns = (await db.prepare('PRAGMA table_info(schools)').all()).map((column) => column.name);
  if (!schoolColumns.includes('list_code')) {
    await client.execute('ALTER TABLE schools ADD COLUMN list_code TEXT');
  }

  // Return notes (damage, missing parts) and one extension of the return date.
  const checkoutExtras = (await db.prepare('PRAGMA table_info(checkouts)').all()).map((column) => column.name);
  if (!checkoutExtras.includes('return_notes')) {
    await client.execute("ALTER TABLE checkouts ADD COLUMN return_notes TEXT NOT NULL DEFAULT ''");
  }
  if (!checkoutExtras.includes('extended')) {
    await client.execute('ALTER TABLE checkouts ADD COLUMN extended INTEGER NOT NULL DEFAULT 0');
  }
  if (!checkoutExtras.includes('original_due_date')) {
    await client.execute('ALTER TABLE checkouts ADD COLUMN original_due_date TEXT');
  }

  // "Log out of all devices" raises this number. Sessions only work for the number they were made with.
  const userColumnsNow = (await db.prepare('PRAGMA table_info(users)').all()).map((column) => column.name);
  if (!userColumnsNow.includes('session_epoch')) {
    await client.execute('ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0');
  }

  // A temporary password set by someone else must be changed at the next login.
  for (const table of ['users', 'students']) {
    const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).map((column) => column.name);
    if (!columns.includes('must_change')) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0`);
    }
  }

  // Check-outs made before student accounts existed have no account.
  const checkoutColumns = (await db.prepare('PRAGMA table_info(checkouts)').all()).map((column) => column.name);
  if (!checkoutColumns.includes('student_account_id')) {
    await client.execute('ALTER TABLE checkouts ADD COLUMN student_account_id INTEGER REFERENCES students(id)');
  }
  await client.execute('CREATE INDEX IF NOT EXISTS checkouts_by_student ON checkouts(student_account_id)');
  return db;
}

// Item codes go inside the QR link. Random, so nobody can guess other items' links.
export function newItemCode() {
  return randomBytes(6).toString('hex');
}

// ownerId is the staff member who listed the item. null means it belongs to the organization.
export async function createItem(db, { name, description = '', category = '', ownerId = null, schoolId = DEFAULT_SCHOOL_ID }) {
  const result = await db
    .prepare('INSERT INTO items (code, name, description, category, owner_id, school_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newItemCode(), name, description, category, ownerId, schoolId, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

// Sign-up codes are random and given to staff by hand.
export function newSignupCode() {
  return randomBytes(9).toString('base64url');
}

export async function createSchool(db, { name, emailDomain = null }) {
  const result = await db
    .prepare('INSERT INTO schools (name, admin_code, teacher_code, email_domain, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, newSignupCode(), newSignupCode(), emailDomain, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

// The first school takes its sign-up codes and email domain from the environment.
// An empty value closes that kind of sign-up.
export async function syncDefaultSchool(db, { adminCode = '', teacherCode = '', emailDomain = '' } = {}) {
  if (adminCode && adminCode === teacherCode) {
    throw new Error('The admin and teacher sign-up codes must be different');
  }
  await db
    .prepare('UPDATE schools SET admin_code = ?, teacher_code = ?, email_domain = ? WHERE id = ?')
    .run(
      adminCode || null,
      teacherCode || null,
      emailDomain.trim().toLowerCase().replace(/^@/, '') || null,
      DEFAULT_SCHOOL_ID
    );
}
