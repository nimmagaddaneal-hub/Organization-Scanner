import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

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

export function createSessionValue(secret) {
  const payload = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return `${payload}.${sign(payload, secret)}`;
}

export function isValidSession(value, secret) {
  if (!value) return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, secret))) return false;
  return Number(payload) > Date.now();
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
