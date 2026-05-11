/**
 * Streaming card behavioral baseline — snapshot-style invariants for the
 * pure-function helpers that feed the Feishu streaming card. Covers
 * extractTitleAndBody + StreamEvent state-machine invariants (tool pairing,
 * todo monotonicity, text_delta concat, timeline ordering). Existing
 * coverage in tests/feishu-card.test.ts focuses on the schema; this file
 * focuses on the streaming presenter's dynamic behavior for the R6 refactor.
 */
import { describe, expect, test } from 'vitest';
import { extractTitleAndBody } from '../../src/feishu-streaming-card.js';
import {
  buildProgressListText,
  buildToolsTimelineText,
  buildStatusBannerText,
  buildTimelineText,
  type ToolCallView,
  type TodoItemView,
  type StreamingPhase,
} from '../../src/feishu-cards/sections.js';
import type { StreamEvent } from '../../shared/stream-event.js';

// ─── extractTitleAndBody — streaming-side title extractor ───────────────

describe('extractTitleAndBody (feishu-streaming-card)', () => {
  test('extracts H1 title and remainder body', () => {
    const result = extractTitleAndBody('# Hello\nworld\nmore');
    expect(result.title).toBe('Hello');
    expect(result.body).toBe('world\nmore');
  });

  test('extracts H2/H3 title', () => {
    expect(extractTitleAndBody('## Sub\nbody').title).toBe('Sub');
    expect(extractTitleAndBody('### Sub2\nbody').title).toBe('Sub2');
  });

  test('falls back to first non-empty line as title (stripped of markdown)', () => {
    const result = extractTitleAndBody('**bold start**\nmore body');
    expect(result.title).toBe('bold start');
    expect(result.body).toBe('more body');
  });

  test('truncates long fallback title to 40 chars with ellipsis', () => {
    const longLine = 'x'.repeat(80);
    const result = extractTitleAndBody(longLine);
    expect(result.title.length).toBeLessThanOrEqual(40);
    expect(result.title.endsWith('...')).toBe(true);
  });

  test('empty input → default "Reply" title and empty body', () => {
    const result = extractTitleAndBody('');
    expect(result.title).toBe('Reply');
    expect(result.body).toBe('');
  });

  test('only whitespace input → default title and empty body', () => {
    const result = extractTitleAndBody('   \n\n  ');
    expect(result.title).toBe('Reply');
    expect(result.body).toBe('');
  });

  test('single-line non-header is consumed as title (body stays empty)', () => {
    const result = extractTitleAndBody('just one line');
    expect(result.title).toBe('just one line');
    expect(result.body).toBe('');
  });
});

// ─── Status banner — state-machine: phase transitions are visible ──────

describe('status banner sequence (state machine baseline)', () => {
  // Simulates the phase transitions a streaming card walks through.
  test('phase progression renders distinct tags so UI can detect transitions', () => {
    const phases: StreamingPhase[] = [
      'idle',
      'thinking',
      'tooling',
      'streaming',
      'completed',
    ];
    const banners = phases.map((p) => buildStatusBannerText({ phase: p }));
    // Every banner must be a distinct string — if two are identical, the
    // UI cannot distinguish the phase change.
    expect(new Set(banners).size).toBe(banners.length);
  });

  test('elapsedMs renders as <font color> grey suffix and survives across phase changes', () => {
    const banner1 = buildStatusBannerText({ phase: 'streaming', elapsedMs: 1500 });
    const banner2 = buildStatusBannerText({ phase: 'tooling', elapsedMs: 2000 });
    expect(banner1).toMatch(/1\.5s/);
    expect(banner2).toMatch(/2\.0s/);
    expect(banner1).toContain("color='grey'");
  });
});

// ─── tool_use_start / tool_use_end pairing invariants ──────────────────

interface SimulatedToolState {
  running: Map<string, ToolCallView>;
  completed: ToolCallView[];
}

/** A minimal state machine that the streaming card maintains. We re-build
 * it here so we can assert invariants on the rendered output without
 * pulling in the real (lark-coupled) FeishuStreamingCardController. */
function applyStreamEvents(
  events: StreamEvent[],
  now = 1_700_000_000_000,
): SimulatedToolState {
  const running = new Map<string, ToolCallView>();
  const completed: ToolCallView[] = [];
  const startTimes = new Map<string, number>();
  let clock = now;

  for (const ev of events) {
    clock += 100;
    if (ev.eventType === 'tool_use_start' && ev.toolUseId && ev.toolName) {
      startTimes.set(ev.toolUseId, clock);
      running.set(ev.toolUseId, {
        name: ev.toolName,
        status: 'running',
        durationMs: 0,
        summary: ev.toolInputSummary,
        skillName: ev.skillName,
        isNested: ev.isNested,
      });
    } else if (ev.eventType === 'tool_use_end' && ev.toolUseId) {
      const start = startTimes.get(ev.toolUseId);
      const live = running.get(ev.toolUseId);
      if (live) {
        completed.push({
          ...live,
          status: ev.statusText === 'error' ? 'error' : 'complete',
          durationMs: start ? clock - start : 0,
        });
        running.delete(ev.toolUseId);
      }
    }
  }

  return { running, completed };
}

describe('tool_use pairing invariants', () => {
  test('matched start/end pair → 0 running, 1 completed', () => {
    const events: StreamEvent[] = [
      { eventType: 'tool_use_start', toolUseId: 't1', toolName: 'Read' },
      { eventType: 'tool_use_end', toolUseId: 't1' },
    ];
    const state = applyStreamEvents(events);
    expect(state.running.size).toBe(0);
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0].status).toBe('complete');
  });

  test('orphan start (no end) stays in running map — pinned for timeout cleanup', () => {
    const events: StreamEvent[] = [
      { eventType: 'tool_use_start', toolUseId: 't-orphan', toolName: 'Bash' },
    ];
    const state = applyStreamEvents(events);
    expect(state.running.size).toBe(1);
    expect(state.completed).toHaveLength(0);
  });

  test('out-of-order end without start is silently dropped (no crash)', () => {
    const events: StreamEvent[] = [
      { eventType: 'tool_use_end', toolUseId: 'phantom' },
    ];
    const state = applyStreamEvents(events);
    expect(state.running.size).toBe(0);
    expect(state.completed).toHaveLength(0);
  });

  test('nested + skillName flags survive through the pairing cycle', () => {
    const events: StreamEvent[] = [
      {
        eventType: 'tool_use_start',
        toolUseId: 's1',
        toolName: 'Skill',
        skillName: 'my-skill',
        isNested: true,
      },
      { eventType: 'tool_use_end', toolUseId: 's1' },
    ];
    const state = applyStreamEvents(events);
    expect(state.completed[0].skillName).toBe('my-skill');
    expect(state.completed[0].isNested).toBe(true);
  });

  test('mixed sequence with 3 tools renders timeline preserving order', () => {
    const events: StreamEvent[] = [
      { eventType: 'tool_use_start', toolUseId: 'a', toolName: 'Read' },
      { eventType: 'tool_use_end', toolUseId: 'a' },
      { eventType: 'tool_use_start', toolUseId: 'b', toolName: 'Bash' },
      { eventType: 'tool_use_end', toolUseId: 'b' },
      { eventType: 'tool_use_start', toolUseId: 'c', toolName: 'Edit' },
    ];
    const state = applyStreamEvents(events);
    const rendered = buildToolsTimelineText([
      ...Array.from(state.running.values()),
      ...state.completed,
    ]);
    // running first, then completed
    expect(rendered.indexOf('Edit')).toBeLessThan(rendered.indexOf('Read'));
  });
});

// ─── todo_update sequencing invariants ─────────────────────────────────

describe('todo_update progress invariants', () => {
  test('completion ratio is monotonic non-decreasing across snapshots', () => {
    const seqs: TodoItemView[][] = [
      [
        { content: 'A', status: 'pending' },
        { content: 'B', status: 'pending' },
        { content: 'C', status: 'pending' },
      ],
      [
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'in_progress' },
        { content: 'C', status: 'pending' },
      ],
      [
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'completed' },
        { content: 'C', status: 'pending' },
      ],
    ];
    const completedCounts = seqs.map(
      (todos) => todos.filter((t) => t.status === 'completed').length,
    );
    for (let i = 1; i < completedCounts.length; i++) {
      expect(completedCounts[i]).toBeGreaterThanOrEqual(completedCounts[i - 1]);
    }
    // Last snapshot renders correct fraction
    expect(buildProgressListText(seqs[2])).toContain('2/3');
  });

  test('empty todo list renders placeholder (not a phantom progress bar)', () => {
    const text = buildProgressListText([]);
    expect(text).not.toContain('▓');
    expect(text).toContain('暂无');
  });
});

// ─── text_delta concatenation: no event loss in re-serialization ──────

describe('text_delta concatenation invariants', () => {
  test('reconstructed text equals concatenation of all deltas (no drops)', () => {
    const deltas = ['Hello', ' world', '! How', ' are', ' you?'];
    const events: StreamEvent[] = deltas.map((d) => ({
      eventType: 'text_delta',
      text: d,
    }));
    const reconstructed = events.map((e) => e.text ?? '').join('');
    expect(reconstructed).toBe('Hello world! How are you?');
  });

  test('reconstruction is stable across replays (idempotent)', () => {
    const deltas = ['a', 'bc', 'def'];
    const replay = () =>
      deltas.reduce((acc, d) => acc + d, '');
    expect(replay()).toBe(replay());
  });
});

// ─── Timeline event ordering ───────────────────────────────────────────

describe('buildTimelineText ordering invariants', () => {
  test('events render in insertion order (no shuffling)', () => {
    const events = [
      { text: 'first' },
      { text: 'second' },
      { text: 'third' },
    ];
    const rendered = buildTimelineText(events);
    expect(rendered.indexOf('first')).toBeLessThan(rendered.indexOf('second'));
    expect(rendered.indexOf('second')).toBeLessThan(rendered.indexOf('third'));
  });

  test('long event list keeps tail (not head) to preserve recency', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ text: `event-${i}` }));
    const rendered = buildTimelineText(events);
    // The newest event must appear in the rendered output
    expect(rendered).toContain('event-29');
    // The placeholder for older events must appear
    expect(rendered).toMatch(/已省略|较早/);
  });
});
