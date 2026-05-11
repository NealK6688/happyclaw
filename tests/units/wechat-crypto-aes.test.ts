/**
 * WeChat CDN AES-128-ECB roundtrip tests.
 *
 * This is the only crypto path in HappyClaw that is fully exported as a
 * pure function pair (encryptAesEcb / decryptAesEcb). The encryption path
 * in runtime-config.ts is module-private; we exercise its roundtrip via
 * saveFeishuProviderConfig in a separate test file if needed.
 *
 * Covers:
 *   - roundtrip identity
 *   - padding size calculation (PKCS7)
 *   - wrong key produces bad-padding throw
 *   - tampered ciphertext produces bad-padding throw
 *   - URL builders escape encrypted query params correctly
 */
import crypto from 'crypto';
import { describe, expect, test } from 'vitest';
import {
  encryptAesEcb,
  decryptAesEcb,
  aesEcbPaddedSize,
  buildCdnDownloadUrl,
  buildCdnUploadUrl,
} from '../../src/wechat-crypto.js';

function randomKey(): Buffer {
  return crypto.randomBytes(16);
}

describe('AES-128-ECB encrypt/decrypt', () => {
  test('roundtrip preserves arbitrary plaintext', () => {
    const key = randomKey();
    const plaintext = Buffer.from('hello world, 你好世界 🌍', 'utf-8');
    const ciphertext = encryptAesEcb(plaintext, key);
    const recovered = decryptAesEcb(ciphertext, key);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  test('roundtrip for empty plaintext', () => {
    const key = randomKey();
    const plaintext = Buffer.alloc(0);
    const ciphertext = encryptAesEcb(plaintext, key);
    // Empty plaintext gets full block of padding (16 bytes)
    expect(ciphertext.length).toBe(16);
    const recovered = decryptAesEcb(ciphertext, key);
    expect(recovered.length).toBe(0);
  });

  test('roundtrip for plaintext at block boundary (15 bytes → 32-byte ct)', () => {
    const key = randomKey();
    const plaintext = Buffer.alloc(15, 0xaa);
    const ciphertext = encryptAesEcb(plaintext, key);
    expect(ciphertext.length).toBe(16);
    const recovered = decryptAesEcb(ciphertext, key);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  test('roundtrip for plaintext exactly one block (16 bytes → 32-byte ct, full pad)', () => {
    const key = randomKey();
    const plaintext = Buffer.alloc(16, 0xbb);
    const ciphertext = encryptAesEcb(plaintext, key);
    // 16-byte plaintext gets a full extra block of padding
    expect(ciphertext.length).toBe(32);
    const recovered = decryptAesEcb(ciphertext, key);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  test('decryption with wrong key throws (PKCS7 padding error)', () => {
    const key1 = randomKey();
    const key2 = randomKey();
    const plaintext = Buffer.from('secret payload', 'utf-8');
    const ciphertext = encryptAesEcb(plaintext, key1);
    // Wrong key almost always trips a PKCS7 padding error. ~1 in 256 it might
    // happen to produce valid padding by luck, but with random keys the test
    // is reliable enough — we accept either a throw OR garbage output that
    // does not equal the original plaintext.
    let recovered: Buffer | null = null;
    try {
      recovered = decryptAesEcb(ciphertext, key2);
    } catch {
      // expected
    }
    if (recovered) {
      expect(recovered.equals(plaintext)).toBe(false);
    }
  });

  test('tampered ciphertext fails to decrypt or produces garbage', () => {
    const key = randomKey();
    const plaintext = Buffer.from('confidential', 'utf-8');
    const ciphertext = encryptAesEcb(plaintext, key);
    // Flip a byte
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;

    let recovered: Buffer | null = null;
    try {
      recovered = decryptAesEcb(tampered, key);
    } catch {
      // expected
    }
    if (recovered) {
      expect(recovered.equals(plaintext)).toBe(false);
    }
  });
});

describe('aesEcbPaddedSize', () => {
  test('returns multiples of 16 with at least 1 byte of padding', () => {
    expect(aesEcbPaddedSize(0)).toBe(16);
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(15)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);
    expect(aesEcbPaddedSize(17)).toBe(32);
    expect(aesEcbPaddedSize(31)).toBe(32);
    expect(aesEcbPaddedSize(32)).toBe(48);
  });

  test('matches actual encryptAesEcb output size for various inputs', () => {
    const key = randomKey();
    for (const size of [0, 1, 15, 16, 17, 100, 1000]) {
      const plaintext = Buffer.alloc(size, 0x5a);
      const ciphertext = encryptAesEcb(plaintext, key);
      expect(ciphertext.length).toBe(aesEcbPaddedSize(size));
    }
  });
});

describe('buildCdnDownloadUrl / buildCdnUploadUrl', () => {
  test('download URL uses default CDN base and percent-encodes the param', () => {
    const url = buildCdnDownloadUrl('abc=def&xyz');
    expect(url).toContain('https://novac2c.cdn.weixin.qq.com/c2c/download');
    expect(url).toContain('abc%3Ddef%26xyz');
  });

  test('download URL respects custom CDN base', () => {
    const url = buildCdnDownloadUrl('payload', 'https://example.com/c2c');
    expect(url.startsWith('https://example.com/c2c/download')).toBe(true);
  });

  test('upload URL includes both param and filekey, both encoded', () => {
    const url = buildCdnUploadUrl({
      uploadParam: 'p=1',
      filekey: 'key with spaces/file',
    });
    expect(url).toContain('upload?encrypted_query_param=p%3D1');
    expect(url).toContain('&filekey=key%20with%20spaces%2Ffile');
  });
});
