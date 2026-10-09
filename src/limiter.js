// Rate limiter that keeps its counts in the database, so the limits survive a restart or a second server.
export function createDbRateLimiter(db, name, maxAttempts, windowMs) {
  const id = (key) => `${name}:${key}`;
  return {
    async isBlocked(key) {
      const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(id(key));
      if (!row) return false;
      if (row.reset_at < Date.now()) {
        await db.prepare('DELETE FROM rate_limits WHERE key = ?').run(id(key));
        return false;
      }
      return row.count >= maxAttempts;
    },
    async recordFailure(key) {
      const now = Date.now();
      const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(id(key));
      if (!row || row.reset_at < now) {
        await db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)').run(id(key), now + windowMs);
      } else {
        await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(id(key));
      }
    },
    async clear(key) {
      await db.prepare('DELETE FROM rate_limits WHERE key = ?').run(id(key));
    },
  };
}
