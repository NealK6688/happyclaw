/**
 * OUTPUT_MARKER parser tests.
 *
 * The parser is the seam between container/host agent stdout and the main
 * process. Wire-protocol bugs here cause silent message loss, so the parser
 * needs ironclad chunk-boundary handling.
 *
 * Focus areas:
 *   - Single marker pair extracted cleanly
 *   - Multiple marker pairs in one chunk
 *   - Marker split across chunk boundaries (the hardest corner case)
 *   - Garbage between markers (treated as untouched)
 *   - Malformed JSON between markers (warns but doesn't crash)
 */
import { describe, expect, test, vi } from 'vitest';
import { Readable } from 'stream';

// Mock runtime-config so we don't depend on real DATA_DIR / file IO
vi.mock('../../src/runtime-config.js', () => ({
  getSystemSettings: () => ({ containerMaxOutputSize: 10 * 1024 * 1024 }),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

const parser = await import('../../src/agent-output-parser.js');
const {
  createStdoutParserState,
  attachStdoutHandler,
  OUTPUT_START_MARKER,
  OUTPUT_END_MARKER,
  isApiError,
} = parser;

/**
 * Push a sequence of chunks through a Readable and collect onOutput calls.
 */
async function runParser(chunks: string[]): Promise<Array<unknown>> {
  const collected: unknown[] = [];
  const stream = new Readable({ read() {} });
  const state = createStdoutParserState();

  attachStdoutHandler(stream, state, {
    groupName: 'test-group',
    label: 'Container',
    resetTimeout: () => {},
    onOutput: async (out) => {
      collected.push(out);
    },
  });

  for (const c of chunks) {
    stream.push(c);
  }
  stream.push(null);

  // Wait a tick for the output chain to settle
  await new Promise((r) => setImmediate(r));
  await state.outputChain;
  return collected;
}

function wrap(payload: object): string {
  return OUTPUT_START_MARKER + JSON.stringify(payload) + OUTPUT_END_MARKER;
}

describe('attachStdoutHandler — marker extraction', () => {
  test('single marker pair extracts payload', async () => {
    const out = await runParser([wrap({ status: 'success', result: 'hi' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'success', result: 'hi' });
  });

  test('two marker pairs in one chunk emit two outputs in order', async () => {
    const c =
      wrap({ status: 'stream', result: null }) +
      wrap({ status: 'success', result: 'done' });
    const out = await runParser([c]);
    expect(out).toHaveLength(2);
    expect((out[0] as { status: string }).status).toBe('stream');
    expect((out[1] as { status: string }).status).toBe('success');
  });

  test('marker split across chunk boundary (start marker split mid-token)', async () => {
    const full = wrap({ status: 'success', result: 'split-ok' });
    // Cut right in the middle of the start marker
    const cut = OUTPUT_START_MARKER.length / 2;
    const c1 = full.slice(0, Math.floor(cut));
    const c2 = full.slice(Math.floor(cut));
    const out = await runParser([c1, c2]);
    expect(out).toHaveLength(1);
    expect((out[0] as { result: string }).result).toBe('split-ok');
  });

  test('marker split at the JSON boundary', async () => {
    const payload = JSON.stringify({ status: 'success', result: 'json-split' });
    const c1 = OUTPUT_START_MARKER + payload.slice(0, 10);
    const c2 = payload.slice(10) + OUTPUT_END_MARKER;
    const out = await runParser([c1, c2]);
    expect(out).toHaveLength(1);
    expect((out[0] as { result: string }).result).toBe('json-split');
  });

  test('marker split byte-by-byte (extreme fragmentation)', async () => {
    const full = wrap({ status: 'success', result: 'frag' });
    const chunks = Array.from(full); // 1 char per chunk
    const out = await runParser(chunks);
    expect(out).toHaveLength(1);
    expect((out[0] as { result: string }).result).toBe('frag');
  });

  test('garbage prefix before first marker is skipped', async () => {
    const c =
      'unrelated stderr-ish prelude\nmore noise\n' +
      wrap({ status: 'success', result: 'after-noise' });
    const out = await runParser([c]);
    expect(out).toHaveLength(1);
    expect((out[0] as { result: string }).result).toBe('after-noise');
  });

  test('garbage between marker pairs is dropped', async () => {
    const c =
      wrap({ status: 'stream', result: null }) +
      'leaky junk\n\n[debug] noise\n' +
      wrap({ status: 'success', result: 'final' });
    const out = await runParser([c]);
    expect(out).toHaveLength(2);
    expect((out[1] as { result: string }).result).toBe('final');
  });

  test('incomplete pair (start without end) does not emit until end arrives', async () => {
    const payload = JSON.stringify({ status: 'success', result: 'partial' });
    const c1 = OUTPUT_START_MARKER + payload;
    // No end marker yet — output should be empty
    const collected: unknown[] = [];
    const stream = new Readable({ read() {} });
    const state = createStdoutParserState();
    attachStdoutHandler(stream, state, {
      groupName: 'g',
      label: 'L',
      resetTimeout: () => {},
      onOutput: async (out) => {
        collected.push(out);
      },
    });
    stream.push(c1);
    await new Promise((r) => setImmediate(r));
    expect(collected).toHaveLength(0);
    // Now deliver end marker
    stream.push(OUTPUT_END_MARKER);
    stream.push(null);
    await new Promise((r) => setImmediate(r));
    await state.outputChain;
    expect(collected).toHaveLength(1);
  });

  test('malformed JSON between markers is logged but does not throw / crash chain', async () => {
    const c =
      OUTPUT_START_MARKER + '{not valid json' + OUTPUT_END_MARKER +
      wrap({ status: 'success', result: 'recovered' });
    const out = await runParser([c]);
    // The malformed pair is dropped; the next valid pair is still emitted
    expect(out).toHaveLength(1);
    expect((out[0] as { result: string }).result).toBe('recovered');
  });

  test('parser state correctly tracks newSessionId across markers', async () => {
    const stream = new Readable({ read() {} });
    const state = createStdoutParserState();
    attachStdoutHandler(stream, state, {
      groupName: 'g',
      label: 'L',
      resetTimeout: () => {},
      onOutput: async () => {},
    });
    stream.push(
      wrap({ status: 'stream', result: null, newSessionId: 'sess-1' }) +
        wrap({ status: 'success', result: null, newSessionId: 'sess-2' }),
    );
    stream.push(null);
    await new Promise((r) => setImmediate(r));
    await state.outputChain;
    expect(state.newSessionId).toBe('sess-2');
    expect(state.hasSuccessOutput).toBe(true);
  });

  test('hasInterruptedOutput tracks interrupted streamEvent', async () => {
    const stream = new Readable({ read() {} });
    const state = createStdoutParserState();
    attachStdoutHandler(stream, state, {
      groupName: 'g',
      label: 'L',
      resetTimeout: () => {},
      onOutput: async () => {},
    });
    stream.push(
      wrap({
        status: 'stream',
        result: null,
        streamEvent: { eventType: 'status', statusText: 'interrupted' },
      }),
    );
    stream.push(null);
    await new Promise((r) => setImmediate(r));
    await state.outputChain;
    expect(state.hasInterruptedOutput).toBe(true);
  });
});

describe('isApiError classifier', () => {
  test('returns true for typical API error patterns', () => {
    expect(isApiError('Error: API key invalid')).toBe(true);
    expect(isApiError('429 rate limit exceeded')).toBe(true);
    expect(isApiError('503 overloaded')).toBe(true);
    expect(isApiError('ECONNRESET reading response')).toBe(true);
    expect(isApiError('ANTHROPIC_API_KEY not set')).toBe(true);
  });

  test('returns false for normal stderr and empty input', () => {
    expect(isApiError('')).toBe(false);
    expect(isApiError('Debug: starting query')).toBe(false);
    expect(isApiError('SyntaxError in user code')).toBe(false);
  });
});
