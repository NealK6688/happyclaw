/**
 * auth.ts pure-function tests.
 *
 * Covers:
 *   - Username/password validation
 *   - Session token sign/verify roundtrip
 *   - Tampered tokens are rejected
 *   - Legacy unsigned tokens are accepted with `legacy: true` flag
 *   - Session expiry check (Date.now mock)
 *   - Login rate limit logic
 *
 * Skipped: bcrypt hashPassword (slow), cookie builders (need Hono ctx mock).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  validateUsername,
  validatePassword,
  signSessionToken,
  verifySessionToken,
  generateSessionToken,
  generateUserId,
  generateInviteCode,
  sessionExpiresAt,
  isSessionExpired,
  checkLoginRateLimit,
  recordLoginAttempt,
  clearLoginAttempts,
} from '../../src/auth.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateUsername', () => {
  test('accepts valid usernames', () => {
    expect(validateUsername('alice')).toBeNull();
    expect(validateUsername('user_42')).toBeNull();
    expect(validateUsername('Alpha1_Beta2_3')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(validateUsername('')).not.toBeNull();
    expect(validateUsername(null as never)).not.toBeNull();
  });

  test('rejects too short (< 3 chars)', () => {
    expect(validateUsername('ab')).not.toBeNull();
  });

  test('rejects too long (> 32 chars)', () => {
    expect(validateUsername('x'.repeat(33))).not.toBeNull();
  });

  test('rejects special characters', () => {
    expect(validateUsername('user-name')).not.toBeNull(); // hyphen
    expect(validateUsername('user.name')).not.toBeNull(); // dot
    expect(validateUsername('user@host')).not.toBeNull();
    expect(validateUsername('user/foo')).not.toBeNull();
  });

  test('rejects whitespace', () => {
    expect(validateUsername(' alice ')).not.toBeNull();
    expect(validateUsername('al ice')).not.toBeNull();
  });
});

describe('validatePassword', () => {
  test('accepts 8+ char passwords', () => {
    expect(validatePassword('abcd1234')).toBeNull();
    expect(validatePassword('correcthorsebatterystaple')).toBeNull();
  });

  test('rejects empty', () => {
    expect(validatePassword('')).not.toBeNull();
  });

  test('rejects < 8 chars', () => {
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('1234567')).not.toBeNull();
  });

  test('rejects > 128 chars', () => {
    expect(validatePassword('a'.repeat(129))).not.toBeNull();
  });
});

describe('signSessionToken + verifySessionToken roundtrip', () => {
  test('valid signed token verifies back to the raw token', () => {
    const raw = generateSessionToken();
    const signed = signSessionToken(raw);
    const result = verifySessionToken(signed);
    expect(result).not.toBeNull();
    expect(result?.token).toBe(raw);
    expect(result?.legacy).toBe(false);
  });

  test('tampered signature is rejected', () => {
    const raw = generateSessionToken();
    const signed = signSessionToken(raw);
    // Flip a char in the signature half
    const dotIdx = signed.lastIndexOf('.');
    const before = signed.slice(0, dotIdx + 1);
    const sig = signed.slice(dotIdx + 1);
    const tampered = before + (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(verifySessionToken(tampered)).toBeNull();
  });

  test('tampered token half is rejected', () => {
    const raw = generateSessionToken();
    const signed = signSessionToken(raw);
    // Append rogue characters to token half
    const dotIdx = signed.lastIndexOf('.');
    const tampered = signed.slice(0, dotIdx) + 'X' + signed.slice(dotIdx);
    expect(verifySessionToken(tampered)).toBeNull();
  });

  test('signature length mismatch is rejected fast (< 64 char sig)', () => {
    expect(verifySessionToken('sometoken.abc')).toBeNull();
  });

  test('legacy unsigned token (no dot) is accepted with legacy=true', () => {
    const result = verifySessionToken('legacytoken_no_dot');
    expect(result?.token).toBe('legacytoken_no_dot');
    expect(result?.legacy).toBe(true);
  });
});

describe('generateSessionToken / generateUserId / generateInviteCode', () => {
  test('session tokens are 64 hex chars', () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  test('user IDs are UUIDv4 format', () => {
    const id = generateUserId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('invite codes are 32 hex chars', () => {
    const c = generateInviteCode();
    expect(c).toMatch(/^[a-f0-9]{32}$/);
  });

  test('two consecutive tokens are different (randomness sanity)', () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});

describe('sessionExpiresAt / isSessionExpired', () => {
  test('newly-issued session is not expired', () => {
    const expiresAt = sessionExpiresAt();
    expect(isSessionExpired(expiresAt)).toBe(false);
  });

  test('expired session is detected when clock advances past expiry', () => {
    const expiresAt = sessionExpiresAt();
    // Advance Date.now past the expiry (~30 days)
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 31 * 24 * 60 * 60 * 1000);
    expect(isSessionExpired(expiresAt)).toBe(true);
  });

  test('past timestamp is expired', () => {
    expect(isSessionExpired('2020-01-01T00:00:00.000Z')).toBe(true);
  });

  test('expiry is ~30 days out (sanity)', () => {
    const t = new Date(sessionExpiresAt()).getTime();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    expect(t - now).toBeGreaterThan(29 * dayMs);
    expect(t - now).toBeLessThan(31 * dayMs);
  });
});

describe('login rate limiting', () => {
  // Use unique username+ip per test to avoid module-global state collisions.
  let counter = 0;
  const nextUser = () => `u-${counter++}-${Math.random().toString(36).slice(2)}`;
  const nextIp = () => `1.2.3.${(counter++) % 250}`;

  test('first attempt is allowed (no record yet)', () => {
    const u = nextUser();
    const ip = nextIp();
    expect(checkLoginRateLimit(u, ip, 5, 15).allowed).toBe(true);
  });

  test('after max attempts, the next check is denied', () => {
    const u = nextUser();
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      recordLoginAttempt(u, ip);
    }
    const result = checkLoginRateLimit(u, ip, 5, 15);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('clearLoginAttempts resets the per-IP counter (but keeps global)', () => {
    const u = nextUser();
    const ip = nextIp();
    for (let i = 0; i < 5; i++) recordLoginAttempt(u, ip);
    clearLoginAttempts(u, ip);
    // Per-IP limit cleared
    expect(checkLoginRateLimit(u, ip, 5, 15).allowed).toBe(true);
  });

  test('global per-username limit is independent of per-IP', () => {
    const u = nextUser();
    // Hit MANY IPs to trip the global counter (5 max-attempts * 4 multiplier = 20)
    for (let i = 0; i < 20; i++) {
      recordLoginAttempt(u, `10.0.0.${i}`);
    }
    // A fresh IP should now be denied by the global limit
    const result = checkLoginRateLimit(u, '10.0.0.250', 5, 15);
    expect(result.allowed).toBe(false);
  });
});
