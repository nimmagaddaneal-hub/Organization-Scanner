import { createHmac, createHash, timingSafeEqual, randomBytes, randomInt, scryptSync } from 'node:crypto';

export const ADMIN_COOKIE = 'admin_session';
const SESSION_HOURS = 8;

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

// Compare through a hash so length differences do not leak through timing.
export function safeEqual(a, b) {
  const hashA = createHash('sha256').update(String(a)).digest();
  const hashB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// A short fingerprint of a password hash. A session only works while it matches, so changing or
// resetting a password logs that account out everywhere else.
export function passwordVersion(hash) {
  return createHash('sha256').update(String(hash)).digest('hex').slice(0, 12);
}

// The session cookie holds "userId.expiry.version.signature". Only the server can make a valid signature.
export function createSessionValue(userId, secret, hours = SESSION_HOURS, version = '0') {
  const payload = `${userId}.${Date.now() + hours * 60 * 60 * 1000}.${version}`;
  return `${payload}.${sign(payload, secret)}`;
}

// Returns { id, version } from a valid, unexpired session cookie, or null.
export function readSession(value, secret) {
  if (!value) return null;
  const [userId, expiry, version, signature] = value.split('.');
  if (!userId || !expiry || !version || !signature) return null;
  if (!safeEqual(signature, sign(`${userId}.${expiry}.${version}`, secret))) return null;
  if (!(Number(expiry) > Date.now())) return null;
  return { id: Number(userId), version };
}

// A temporary password to hand to someone. No look-alike characters (0 O 1 l I).
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function temporaryPassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}

// Passwords are stored only as salted scrypt hashes.
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const sessionMaxAgeMs = SESSION_HOURS * 60 * 60 * 1000;

// Small in-memory limiter for password and return-verification guesses.
export function createRateLimiter(maxAttempts, windowMs) {
  const attempts = new Map();
  return {
    isBlocked(key) {
      const entry = attempts.get(key);
      if (!entry) return false;
      if (entry.resetAt < Date.now()) {
        attempts.delete(key);
        return false;
      }
      return entry.count >= maxAttempts;
    },
    recordFailure(key) {
      const entry = attempts.get(key);
      if (!entry || entry.resetAt < Date.now()) {
        attempts.set(key, { count: 1, resetAt: Date.now() + windowMs });
      } else {
        entry.count += 1;
      }
    },
    clear(key) {
      attempts.delete(key);
    },
  };
}
