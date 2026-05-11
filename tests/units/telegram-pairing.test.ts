/**
 * Telegram pairing code lifecycle tests.
 *
 * Covers:
 *   - generate → verify happy path
 *   - single-use semantics (second verify fails)
 *   - one active code per user (regenerate invalidates old)
 *   - expiry behavior (Date.now mock)
 *   - case-insensitive code input (verify with lower-case)
 *   - unknown code returns null
 *
 * NOTE: The pairing store is process-global. The tests rely on unique userIds
 * to avoid cross-test interference rather than trying to reset module state.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  generatePairingCode,
  verifyPairingCode,
} from '../../src/telegram-pairing.js';

describe('generatePairingCode + verifyPairingCode', () => {
  let userCounter = 0;
  function nextUser(): string {
    userCounter++;
    return `user-${userCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  test('happy path: generate then verify returns the userId', () => {
    const userId = nextUser();
    const { code } = generatePairingCode(userId);
    expect(code).toHaveLength(6);
    expect(/^[A-Z0-9]{6}$/.test(code)).toBe(true);

    const result = verifyPairingCode(code);
    expect(result).toEqual({ userId });
  });

  test('verify is single-use: second call returns null', () => {
    const userId = nextUser();
    const { code } = generatePairingCode(userId);
    expect(verifyPairingCode(code)).toEqual({ userId });
    expect(verifyPairingCode(code)).toBeNull();
  });

  test('lowercase input is matched against canonical uppercase', () => {
    const userId = nextUser();
    const { code } = generatePairingCode(userId);
    const result = verifyPairingCode(code.toLowerCase());
    expect(result).toEqual({ userId });
  });

  test('regenerating for same user invalidates the previous code', () => {
    const userId = nextUser();
    const { code: code1 } = generatePairingCode(userId);
    const { code: code2 } = generatePairingCode(userId);
    expect(code1).not.toBe(code2);
    expect(verifyPairingCode(code1)).toBeNull();
    expect(verifyPairingCode(code2)).toEqual({ userId });
  });

  test('verify with unknown code returns null', () => {
    expect(verifyPairingCode('XXXXXX')).toBeNull();
    expect(verifyPairingCode('')).toBeNull();
  });

  test('ttlSeconds is 300 (5 minutes)', () => {
    const { ttlSeconds } = generatePairingCode(nextUser());
    expect(ttlSeconds).toBe(300);
  });

  test('expiresAt is approximately now + 5 minutes', () => {
    const before = Date.now();
    const { expiresAt } = generatePairingCode(nextUser());
    const after = Date.now();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 5 * 60 * 1000);
  });

  test('expired code returns null on verify (Date.now mocked)', () => {
    const userId = nextUser();
    const { code } = generatePairingCode(userId);
    // Advance time past TTL
    const realNow = Date.now;
    try {
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 6 * 60 * 1000);
      expect(verifyPairingCode(code)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('codes use uniform alphanumeric alphabet (sanity-check for bias)', () => {
    // Generate a batch and confirm character set is within the expected set
    const charSet = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { code } = generatePairingCode(nextUser());
      for (const ch of code) charSet.add(ch);
    }
    for (const ch of charSet) {
      expect(/[A-Z0-9]/.test(ch)).toBe(true);
    }
  });

  test('different users get different codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { code } = generatePairingCode(nextUser());
      codes.add(code);
    }
    expect(codes.size).toBe(20);
  });
});
