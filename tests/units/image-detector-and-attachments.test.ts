/**
 * image-detector + message-attachments tests.
 *
 * These functions decide whether incoming attachments are treated as Vision
 * input (image bytes sent to the model) or dropped. Wrong MIME → broken
 * Vision; wrong dropping → silently lost user-attached images.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  detectImageMimeTypeStrict,
  detectImageMimeType,
  detectImageMimeTypeFromBase64Strict,
  detectImageMimeTypeFromBase64,
} from '../../src/image-detector.js';
import {
  normalizeImageAttachment,
  normalizeImageAttachments,
  toAgentImages,
} from '../../src/message-attachments.js';

// ─── Magic-byte fixtures ───────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...Array.from({ length: 8 }, () => 0),
]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]);
const GIF_MAGIC = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(10).fill(0),
]);
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ...Array(8).fill(0),
]);
const BMP_MAGIC = Buffer.from([0x42, 0x4d, ...Array(20).fill(0)]);
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00, ...Array(20).fill(0)]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, ...Array(20).fill(0)]);
const AVIF_MAGIC = Buffer.from([
  0x00, 0x00, 0x00, 0x20, // box size (unused by detector)
  0x66, 0x74, 0x79, 0x70, // 'ftyp'
  0x61, 0x76, 0x69, 0x66, // 'avif'
  ...Array(8).fill(0),
]);

describe('detectImageMimeTypeStrict', () => {
  test('detects PNG by magic', () => {
    expect(detectImageMimeTypeStrict(PNG_MAGIC)).toBe('image/png');
  });

  test('detects JPEG by magic', () => {
    expect(detectImageMimeTypeStrict(JPEG_MAGIC)).toBe('image/jpeg');
  });

  test('detects GIF89a by magic', () => {
    expect(detectImageMimeTypeStrict(GIF_MAGIC)).toBe('image/gif');
  });

  test('detects WebP by RIFF+WEBP signature', () => {
    expect(detectImageMimeTypeStrict(WEBP_MAGIC)).toBe('image/webp');
  });

  test('detects BMP by magic', () => {
    expect(detectImageMimeTypeStrict(BMP_MAGIC)).toBe('image/bmp');
  });

  test('detects TIFF (LE and BE)', () => {
    expect(detectImageMimeTypeStrict(TIFF_LE)).toBe('image/tiff');
    expect(detectImageMimeTypeStrict(TIFF_BE)).toBe('image/tiff');
  });

  test('detects AVIF by ftyp box', () => {
    expect(detectImageMimeTypeStrict(AVIF_MAGIC)).toBe('image/avif');
  });

  test('returns null for unknown buffer', () => {
    const unknown = Buffer.from('this-is-not-an-image-this-is-not');
    expect(detectImageMimeTypeStrict(unknown)).toBe(null);
  });

  test('returns null for too-short buffer (<12 bytes)', () => {
    expect(detectImageMimeTypeStrict(Buffer.from([0xff, 0xd8, 0xff]))).toBe(
      null,
    );
    expect(detectImageMimeTypeStrict(Buffer.alloc(0))).toBe(null);
  });
});

describe('detectImageMimeType (with fallback)', () => {
  test('returns detected type when known', () => {
    expect(detectImageMimeType(PNG_MAGIC)).toBe('image/png');
  });

  test('falls back to image/jpeg for unknown buffer', () => {
    const unknown = Buffer.from('definitely-not-an-image-here');
    expect(detectImageMimeType(unknown)).toBe('image/jpeg');
  });
});

describe('detectImageMimeTypeFromBase64Strict', () => {
  test('detects PNG from base64-encoded magic bytes', () => {
    const b64 = PNG_MAGIC.toString('base64');
    expect(detectImageMimeTypeFromBase64Strict(b64)).toBe('image/png');
  });

  test('detects JPEG from base64-encoded magic bytes', () => {
    const b64 = JPEG_MAGIC.toString('base64');
    expect(detectImageMimeTypeFromBase64Strict(b64)).toBe('image/jpeg');
  });

  test('returns null for non-image base64', () => {
    const b64 = Buffer.from('not an image').toString('base64');
    expect(detectImageMimeTypeFromBase64Strict(b64)).toBe(null);
  });
});

describe('detectImageMimeTypeFromBase64 (with fallback)', () => {
  test('falls back to image/jpeg when unknown', () => {
    const b64 = Buffer.from('not an image at all').toString('base64');
    expect(detectImageMimeTypeFromBase64(b64)).toBe('image/jpeg');
  });
});

// ─── normalizeImageAttachment ──────────────────────────────────────────

describe('normalizeImageAttachment', () => {
  test('accepts raw base64 + declared mime', () => {
    const b64 = PNG_MAGIC.toString('base64');
    const result = normalizeImageAttachment({
      type: 'image',
      data: b64,
      mimeType: 'image/png',
    });
    expect(result?.mimeType).toBe('image/png');
    expect(result?.data).toBe(b64);
  });

  test('parses data URL prefix and extracts hinted mime', () => {
    const b64 = JPEG_MAGIC.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    const result = normalizeImageAttachment({ data: dataUrl });
    expect(result?.mimeType).toBe('image/jpeg');
    expect(result?.data).toBe(b64);
  });

  test('declared mime mismatch triggers onMimeMismatch and uses detected', () => {
    const b64 = PNG_MAGIC.toString('base64');
    const onMismatch = vi.fn();
    const result = normalizeImageAttachment(
      { data: b64, mimeType: 'image/gif' /* lies */ },
      { onMimeMismatch: onMismatch },
    );
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(result?.mimeType).toBe('image/png'); // detected wins
  });

  test('falls back to image/jpeg when neither declared nor detected', () => {
    const b64 = Buffer.from('random bytes here').toString('base64');
    const result = normalizeImageAttachment({ data: b64 });
    expect(result?.mimeType).toBe('image/jpeg');
  });

  test('rejects empty data', () => {
    expect(normalizeImageAttachment({ data: '' })).toBe(null);
  });

  test('rejects non-string data', () => {
    expect(normalizeImageAttachment({ data: 123 as never })).toBe(null);
    expect(normalizeImageAttachment({ data: null })).toBe(null);
  });

  test('rejects non-image type', () => {
    expect(normalizeImageAttachment({ type: 'file', data: 'xyz' })).toBe(null);
  });

  test('missing type defaults to image (legacy attachment shape)', () => {
    const b64 = PNG_MAGIC.toString('base64');
    expect(normalizeImageAttachment({ data: b64 })?.type).toBe('image');
  });

  test('normalizes whitespace in base64 payload', () => {
    const b64 = PNG_MAGIC.toString('base64');
    const spaced = b64.replace(/(.{4})/g, '$1\n ');
    const result = normalizeImageAttachment({ data: spaced });
    expect(result?.data).toBe(b64);
  });
});

describe('normalizeImageAttachments (batch)', () => {
  test('drops invalid entries and keeps valid ones', () => {
    const b64 = PNG_MAGIC.toString('base64');
    const result = normalizeImageAttachments([
      { data: b64, mimeType: 'image/png' },
      { data: '' }, // invalid
      null, // invalid
      { type: 'file', data: 'x' }, // wrong type
      { data: b64 }, // valid
    ]);
    expect(result).toHaveLength(2);
  });

  test('returns empty array for non-array input', () => {
    expect(normalizeImageAttachments(null)).toEqual([]);
    expect(normalizeImageAttachments('foo')).toEqual([]);
  });
});

describe('toAgentImages', () => {
  test('strips wrapping type field, keeps data + mimeType', () => {
    const b64 = PNG_MAGIC.toString('base64');
    const normalized = normalizeImageAttachments([
      { data: b64, mimeType: 'image/png' },
    ]);
    const agentImgs = toAgentImages(normalized);
    expect(agentImgs).toEqual([{ data: b64, mimeType: 'image/png' }]);
  });

  test('returns undefined for empty input (lets caller omit images: [])', () => {
    expect(toAgentImages(undefined)).toBe(undefined);
    expect(toAgentImages([])).toBe(undefined);
  });
});
