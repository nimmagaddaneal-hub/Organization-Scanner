import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const SCHEMA = `
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

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Databases made before staff accounts existed have no owner column on items.
  const itemColumns = db.prepare('PRAGMA table_info(items)').all().map((column) => column.name);
  if (!itemColumns.includes('owner_id')) {
    db.exec('ALTER TABLE items ADD COLUMN owner_id INTEGER REFERENCES users(id)');
  }
  return db;
}

// Item codes go inside the QR link. Random, so nobody can guess other items' links.
export function newItemCode() {
  return randomBytes(6).toString('hex');
}

// ownerId is the staff member who listed the item. null means it belongs to the organization.
export function createItem(db, { name, description = '', ownerId = null }) {
  const result = db
    .prepare('INSERT INTO items (code, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(newItemCode(), name, description, ownerId, new Date().toISOString());
  return Number(result.lastInsertRowid);
}
