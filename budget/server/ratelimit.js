import { db } from './db.js';

// Progressive lockout: the first `freeAttempts` failures are free, then the block
// doubles each extra failure up to `maxBlockMs`. Buckets are keyed per action AND
// per identity (IP, email) so one attacker cannot lock out every account.
const POLICIES = {
  login: { freeAttempts: 5, baseBlockMs: 30_000, maxBlockMs: 15 * 60_000, windowMs: 60 * 60_000 },
  signup: { freeAttempts: 5, baseBlockMs: 60_000, maxBlockMs: 60 * 60_000, windowMs: 60 * 60_000 },
  verify: { freeAttempts: 10, baseBlockMs: 30_000, maxBlockMs: 15 * 60_000, windowMs: 60 * 60_000 },
  sync: { freeAttempts: 600, baseBlockMs: 10_000, maxBlockMs: 60_000, windowMs: 60_000 },
};

export function checkLimit(action, identity) {
  const policy = POLICIES[action];
  if (!policy) return { allowed: true, retryAfterMs: 0 };
  const bucket = `${action}:${identity}`;
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket = ?').get(bucket);
  const now = Date.now();
  if (!row) return { allowed: true, retryAfterMs: 0 };
  if (row.blocked_until > now) {
    return { allowed: false, retryAfterMs: row.blocked_until - now };
  }
  if (now - row.first_attempt_at > policy.windowMs) {
    db.prepare('DELETE FROM rate_limits WHERE bucket = ?').run(bucket);
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function registerFailure(action, identity) {
  const policy = POLICIES[action];
  if (!policy) return { allowed: true, retryAfterMs: 0 };
  const bucket = `${action}:${identity}`;
  const now = Date.now();
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket = ?').get(bucket);

  if (!row || now - row.first_attempt_at > policy.windowMs) {
    db.prepare(`
      INSERT INTO rate_limits (bucket, attempts, first_attempt_at, blocked_until)
      VALUES (?, 1, ?, 0)
      ON CONFLICT(bucket) DO UPDATE SET attempts = 1, first_attempt_at = excluded.first_attempt_at, blocked_until = 0
    `).run(bucket, now);
    return { allowed: true, retryAfterMs: 0 };
  }

  const attempts = row.attempts + 1;
  let blockedUntil = 0;
  if (attempts > policy.freeAttempts) {
    const extraStrikes = attempts - policy.freeAttempts - 1;
    const blockMs = Math.min(policy.baseBlockMs * 2 ** extraStrikes, policy.maxBlockMs);
    blockedUntil = now + blockMs;
  }
  db.prepare('UPDATE rate_limits SET attempts = ?, blocked_until = ? WHERE bucket = ?').run(attempts, blockedUntil, bucket);
  return { allowed: blockedUntil === 0, retryAfterMs: Math.max(0, blockedUntil - now) };
}

export function clearLimit(action, identity) {
  db.prepare('DELETE FROM rate_limits WHERE bucket = ?').run(`${action}:${identity}`);
}
