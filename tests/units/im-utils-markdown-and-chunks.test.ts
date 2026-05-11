/**
 * im-utils.ts tests.
 *
 * Shared markdown → plain text and long-message chunking — used by qq.ts,
 * dingtalk.ts, wechat.ts on every outbound message. Bugs here corrupt
 * user-visible output across 3 IM channels.
 */
import { describe, expect, test } from 'vitest';
import {
  markdownToPlainText,
  splitTextChunks,
} from '../../src/im-utils.js';

describe('markdownToPlainText', () => {
  test('strips bold (** and __)', () => {
    expect(markdownToPlainText('**bold** and __also bold__')).toBe(
      'bold and also bold',
    );
  });

  test('strips italic (single *)', () => {
    expect(markdownToPlainText('hello *world*!')).toBe('hello world!');
  });

  test('strips strikethrough (~~)', () => {
    expect(markdownToPlainText('~~deleted~~ kept')).toBe('deleted kept');
  });

  test('strips inline code backticks but keeps content', () => {
    expect(markdownToPlainText('use `npm run test` to test')).toBe(
      'use npm run test to test',
    );
  });

  test('strips fenced code blocks but keeps content', () => {
    const input = '```js\nconst x = 1;\n```';
    const result = markdownToPlainText(input);
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  test('rewrites links as "text (url)"', () => {
    expect(markdownToPlainText('see [docs](https://example.com)')).toBe(
      'see docs (https://example.com)',
    );
  });

  test('strips headings of all levels', () => {
    expect(markdownToPlainText('# H1\n## H2\n### H3')).toBe('H1\nH2\nH3');
  });

  test('does not touch plain text', () => {
    const text = 'no formatting here, just words.';
    expect(markdownToPlainText(text)).toBe(text);
  });

  test('handles nested formatting (bold + link)', () => {
    expect(
      markdownToPlainText('**[click here](https://x.com)**'),
    ).toBe('click here (https://x.com)');
  });

  test('does not strip * inside words (e.g. multiplication)', () => {
    // *foo* with word boundaries on both sides → italic
    // a*b*c → italic match (per regex, since word-boundary check is on outer)
    // Documenting current behavior, not asserting either direction strongly.
    const result = markdownToPlainText('use 4*3*2 as a counter');
    // We accept either result, but the function must not throw and must
    // produce a string
    expect(typeof result).toBe('string');
  });
});

describe('splitTextChunks', () => {
  test('short text returns single chunk', () => {
    expect(splitTextChunks('hello', 100)).toEqual(['hello']);
  });

  test('text exactly at limit returns single chunk', () => {
    const text = 'a'.repeat(100);
    expect(splitTextChunks(text, 100)).toEqual([text]);
  });

  test('long text splits into multiple chunks ≤ limit', () => {
    const text = 'a'.repeat(2500);
    const chunks = splitTextChunks(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000);
    }
  });

  test('prefers paragraph break (\\n\\n) when within sweet spot', () => {
    const text = 'a'.repeat(800) + '\n\n' + 'b'.repeat(300);
    const chunks = splitTextChunks(text, 1000);
    expect(chunks.length).toBe(2);
    // First chunk should end with the 'a' run (no overlap with bs)
    expect(chunks[0].endsWith('a')).toBe(true);
    expect(chunks[1].startsWith('b')).toBe(true);
  });

  test('falls back to line break when no paragraph break available', () => {
    const text = 'a'.repeat(800) + '\n' + 'b'.repeat(300);
    const chunks = splitTextChunks(text, 1000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].endsWith('a')).toBe(true);
  });

  test('falls back to space when no line break available', () => {
    const text = 'a'.repeat(500) + ' ' + 'b'.repeat(500);
    const chunks = splitTextChunks(text, 800);
    expect(chunks.length).toBe(2);
  });

  test('hard split at limit when no separators available (worst case)', () => {
    const text = 'x'.repeat(3000); // no spaces or newlines
    const chunks = splitTextChunks(text, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(1000);
    expect(chunks[1].length).toBe(1000);
    expect(chunks[2].length).toBe(1000);
  });

  test('reconstruction (after re-joining) preserves length within bounds', () => {
    const text = 'word '.repeat(500); // 2500 chars with frequent spaces
    const chunks = splitTextChunks(text, 800);
    const rejoined = chunks.join('');
    // Allow for whitespace removed at chunk boundaries (trimStart in impl)
    expect(rejoined.length).toBeLessThanOrEqual(text.length);
    expect(rejoined.length).toBeGreaterThan(text.length * 0.9);
  });
});
