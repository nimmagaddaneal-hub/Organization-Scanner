// Deletes old records so the site does not keep students' details forever.
// Each school chooses how long to keep returned check-outs (0 = keep). Some housekeeping applies to everyone.
const DAY = 24 * 60 * 60 * 1000;

export async function purgeOldRecords(db, now = Date.now()) {
  const counts = { checkouts: 0, log: 0, waitlist: 0, limits: 0 };
  const schools = await db.prepare('SELECT id, retention_years FROM schools WHERE retention_years > 0').all();
  for (const school of schools) {
    const cutoff = new Date(now - school.retention_years * 365 * DAY).toISOString();
    counts.checkouts += (
      await db
        .prepare(
          `DELETE FROM checkouts WHERE returned_at IS NOT NULL AND returned_at < ?
             AND item_id IN (SELECT id FROM items WHERE school_id = ?)`
        )
        .run(cutoff, school.id)
    ).changes;
    counts.log += (await db.prepare('DELETE FROM audit_log WHERE school_id = ? AND at < ?').run(school.id, cutoff)).changes;
  }
  // Waiting-list entries older than six months are stale. Expired rate-limit counts are no longer needed.
  counts.waitlist = (await db.prepare('DELETE FROM waitlist WHERE created_at < ?').run(new Date(now - 180 * DAY).toISOString())).changes;
  counts.limits = (await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(now)).changes;
  return counts;
}

// Runs now and then once a day while the server is up.
export function schedulePurge(db, log = console) {
  const run = () =>
    purgeOldRecords(db)
      .then((counts) => {
        if (counts.checkouts || counts.log || counts.waitlist) log.log('Removed old records:', JSON.stringify(counts));
      })
      .catch((error) => log.error('Could not remove old records:', error.message));
  run();
  const timer = setInterval(run, DAY);
  timer.unref?.();
  return timer;
}
