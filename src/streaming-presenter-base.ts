/**
 * StreamingPresenter Base (R6)
 *
 * 公共抽象层，4 套渠道 streaming card 实现（feishu / dingtalk / qq / discord）
 * 应该继承本模块的纯函数 + 类型 + 常量。
 *
 * 第一阶段（R6 POC 2026-05）：抽离 feishu-streaming-card.ts 内的纯函数 + 类型 + 常量。
 * feishu-streaming-card.ts 改 import from './streaming-presenter-base.js'，
 * 现有行为 100% 不变，只是公共代码集中化。
 *
 * 第二阶段（后续 sprint）：dingtalk / qq / discord 渐进迁移到 import 公共代码 +
 * 让 StreamingCardController 继承 StreamingPresenterBase。
 *
 * 第三阶段（最终）：4 套渠道完全共享 buffer / flush / 状态机，每个渠道只实现
 * onCardUpdate(content) 抽象方法。
 */

// ─── Types ────────────────────────────────────────────────────
//
// 注意：feishu-streaming-card.ts 当前有自己的 ToolCallState / StreamingState
// 定义（与本文件 shape 略有不同）。本模块的对应类型加 `Base` 前缀避免命名冲突，
// 仅作为后续 sprint 渠道迁移到 StreamingPresenterBase 时的参考。

/** Streaming session 状态枚举（后续 sprint 用） */
export type BaseStreamingState =
  | 'idle'
  | 'creating'
  | 'streaming'
  | 'completed'
  | 'aborted'
  | 'error'
  | 'frozen';

/** Fenced code block range in markdown text */
export interface CodeBlockRange {
  open: number;
  close: number;
  lang: string;
}

/** Tool call execution state — generic 版本（feishu 用自己的 inline 版本，dingtalk/qq/discord 迁移时用此） */
export interface BaseToolCallState {
  toolName: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'success' | 'error';
  resultSummary?: string;
  /** parentToolUseId — set when called by a sub-agent (Task / Code Interpreter) */
  parentToolUseId?: string | null;
  isNested?: boolean;
  toolInput?: Record<string, unknown>;
}

/** Tool call metadata returned to controller / external listeners */
export interface BaseToolCallMeta {
  toolName: string;
  toolUseId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'success' | 'error';
  resultSummary?: string;
}

/** Recent stream event for debug / display */
export interface RecentStreamEvent {
  type: string;
  timestamp: number;
  text?: string;
}

/** Todo item from TodoWrite tool */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// ─── Constants ────────────────────────────────────────────────

/** Max chars for thinking / reasoning text display (per panel) */
export const MAX_THINKING_CHARS = 800;

/** Max recent events kept for the "调用轨迹" panel */
export const MAX_RECENT_EVENTS = 5;

/** Max tools displayed in the "工具时间轴" panel */
export const MAX_TOOL_DISPLAY = 5;

/** Max todos displayed in the "Todo 进度" panel */
export const MAX_TODO_DISPLAY = 10;

/** Max chars per tool input summary */
export const MAX_TOOL_SUMMARY_CHARS = 60;

/** Max chars per card element (Feishu V2 element content limit) */
export const MAX_ELEMENT_CHARS = 4000;

/** Purge completed tools older than this from active display (ms) */
export const MAX_COMPLETED_TOOL_AGE = 30_000;

// ─── Pure Functions: markdown code-block-aware splitting ──────

/**
 * Scan text for fenced code block ranges (``` ... ```).
 * Unclosed code blocks are treated as extending to end of text.
 */
export function findCodeBlockRanges(text: string): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  const regex = /^```(\w*)\s*$/gm;
  let match: RegExpExecArray | null;
  let openMatch: RegExpExecArray | null = null;
  let openLang = '';

  while ((match = regex.exec(text)) !== null) {
    if (!openMatch) {
      openMatch = match;
      openLang = match[1] || '';
    } else {
      ranges.push({
        open: openMatch.index,
        close: match.index + match[0].length,
        lang: openLang,
      });
      openMatch = null;
      openLang = '';
    }
  }

  if (openMatch) {
    ranges.push({
      open: openMatch.index,
      close: text.length,
      lang: openLang,
    });
  }

  return ranges;
}

/**
 * Check if a position falls inside any code block range.
 * Returns the containing range or null.
 */
export function findContainingBlock(
  pos: number,
  ranges: CodeBlockRange[],
): CodeBlockRange | null {
  for (const r of ranges) {
    if (pos > r.open && pos < r.close) return r;
  }
  return null;
}

/**
 * Split text into chunks ≤ maxLen, respecting fenced code block boundaries.
 * Never truncates inside a code block without properly closing / reopening the fence.
 */
export function splitCodeBlockSafe(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Recompute ranges on current remaining text each iteration.
    const ranges = findCodeBlockRanges(remaining);

    let idx = remaining.lastIndexOf('\n\n', maxLen);
    if (idx < maxLen * 0.3) idx = remaining.lastIndexOf('\n', maxLen);
    if (idx < maxLen * 0.3) idx = maxLen;

    const block = findContainingBlock(idx, ranges);

    if (block) {
      if (block.open > 0 && block.open > maxLen * 0.3) {
        // Retreat to just before the code block opening
        const retreatIdx = remaining.lastIndexOf('\n', block.open);
        idx = retreatIdx > maxLen * 0.3 ? retreatIdx : block.open;
        chunks.push(remaining.slice(0, idx).trimEnd());
        remaining = remaining.slice(idx).replace(/^\n+/, '');
      } else {
        // Block starts too early to retreat — split inside but close / reopen fence
        const chunk = remaining.slice(0, idx).trimEnd() + '\n```';
        chunks.push(chunk);
        const reopener = '```' + block.lang + '\n';
        remaining = reopener + remaining.slice(idx).replace(/^\n/, '');
      }
    } else {
      chunks.push(remaining.slice(0, idx).trimEnd());
      remaining = remaining.slice(idx).replace(/^\n+/, '');
    }
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

// ─── Pure Functions: text formatting ──────────────────────────

/**
 * Extract a short title (≤40 chars, # heading or first non-empty line) and the rest as body.
 * Used to assemble streaming card headers from agent output.
 */
export function extractTitleAndBody(text: string): {
  title: string;
  body: string;
} {
  const lines = text.split('\n');
  let title = '';
  let bodyStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (/^#{1,3}\s+/.test(lines[i])) {
      title = lines[i].replace(/^#+\s*/, '').trim();
    } else {
      const firstLine = lines[i].replace(/[*_`#\[\]]/g, '').trim();
      title =
        firstLine.length > 40 ? firstLine.slice(0, 37) + '...' : firstLine;
    }
    bodyStartIdx = i + 1;
    break;
  }

  const body = lines.slice(bodyStartIdx).join('\n').trim();

  if (!title) title = 'Reply';

  return { title, body };
}

/** Format elapsed milliseconds as human-readable duration (Xms / X.Xs / Xm Xs) */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${Math.floor(sec % 60)}s`;
}

/** Format usage stats note: "💰 X/Y tokens · $Z · Ns · N turns" */
export function formatUsageNote(usage: {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  durationMs: number;
  numTurns: number;
}): string {
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  const parts: string[] = [];
  parts.push(`${fmt(usage.inputTokens)} / ${fmt(usage.outputTokens)} tokens`);
  if (usage.costUSD > 0) parts.push(`$${usage.costUSD.toFixed(4)}`);
  if (usage.durationMs > 0)
    parts.push(`${(usage.durationMs / 1000).toFixed(1)}s`);
  if (usage.numTurns > 1) parts.push(`${usage.numTurns} turns`);
  return `💰 ${parts.join(' · ')}`;
}

/** Quick non-cryptographic hash for content equality comparison */
export function quickHash(data: string): string {
  let h = 5381;
  for (let i = 0; i < data.length; i++) {
    h = ((h << 5) + h + data.charCodeAt(i)) & 0xffffffff;
  }
  return h.toString(36);
}

// ─── Abstract Presenter Interface ─────────────────────────────

/**
 * Abstract StreamingPresenter interface.
 *
 * Each channel (feishu / dingtalk / qq / discord) should eventually implement
 * this interface. Currently only used as a design contract — feishu-streaming-card.ts
 * has its own StreamingCardController that doesn't yet implement this directly.
 *
 * 设计目标：让上层 container-runner.ts 不再 if-else 4 个渠道，而是 dispatch 给统一接口。
 */
export interface IStreamingPresenter {
  /** Append text delta and schedule a flush. */
  appendText(delta: string): void;

  /** Append thinking / reasoning text delta. */
  appendThinking(delta: string): void;

  /** Record tool call start. */
  recordToolStart(
    toolName: string,
    toolUseId: string,
    input?: Record<string, unknown>,
    parentToolUseId?: string | null,
  ): void;

  /** Record tool call completion. */
  recordToolEnd(
    toolUseId: string,
    status: 'success' | 'error',
    resultSummary?: string,
  ): void;

  /** Update todo list from TodoWrite. */
  updateTodos(todos: TodoItem[]): void;

  /** Finalize and flush remaining content. */
  finalize(state?: BaseStreamingState): Promise<void>;
}

/**
 * Lightweight base class with shared state management.
 *
 * Channels can extend this to inherit:
 *  - fullText buffer
 *  - tools Map
 *  - todos array
 *  - thinking text buffer
 *  - recent events ring buffer
 *
 * Subclasses must implement onFlush(content) to push the accumulated content
 * to the channel's specific transport (Feishu Card API / DingTalk AI Card /
 * QQ Forward / Discord Edit).
 *
 * 当前未被 feishu 直接使用 —— 仅作为后续渐进重构的参考实现。
 */
export abstract class StreamingPresenterBase implements IStreamingPresenter {
  protected fullText = '';
  protected thinking = '';
  protected tools = new Map<string, BaseToolCallState>();
  protected todos: TodoItem[] = [];
  protected recentEvents: RecentStreamEvent[] = [];
  protected state: BaseStreamingState = 'streaming';
  protected startedAt = Date.now();

  appendText(delta: string): void {
    if (!delta) return;
    this.fullText += delta;
    this.pushEvent('text_delta', delta);
    this.scheduleFlush();
  }

  appendThinking(delta: string): void {
    if (!delta) return;
    this.thinking += delta;
    if (this.thinking.length > MAX_THINKING_CHARS) {
      // Keep tail to avoid memory bloat
      this.thinking = this.thinking.slice(-MAX_THINKING_CHARS);
    }
    this.pushEvent('thinking_delta');
    this.scheduleFlush();
  }

  recordToolStart(
    toolName: string,
    toolUseId: string,
    input?: Record<string, unknown>,
    parentToolUseId?: string | null,
  ): void {
    this.tools.set(toolUseId, {
      toolName,
      toolUseId,
      startTime: Date.now(),
      status: 'running',
      toolInput: input,
      parentToolUseId: parentToolUseId ?? null,
      isNested: !!parentToolUseId,
    });
    this.pushEvent('tool_use_start', `${toolName}`);
    this.scheduleFlush();
  }

  recordToolEnd(
    toolUseId: string,
    status: 'success' | 'error',
    resultSummary?: string,
  ): void {
    const tool = this.tools.get(toolUseId);
    if (!tool) return;
    tool.endTime = Date.now();
    tool.status = status;
    tool.resultSummary = resultSummary;
    this.pushEvent('tool_use_end', tool.toolName);
    this.scheduleFlush();
  }

  updateTodos(todos: TodoItem[]): void {
    this.todos = todos.slice(0, MAX_TODO_DISPLAY);
    this.pushEvent('todo_update');
    this.scheduleFlush();
  }

  async finalize(state: BaseStreamingState = 'completed'): Promise<void> {
    this.state = state;
    this.purgeOldCompletedTools();
    await this.onFlush(this.fullText);
  }

  /** Subclass hook: render and push the accumulated content to channel-specific transport. */
  protected abstract onFlush(content: string): Promise<void>;

  /** Subclass hook: schedule a debounced flush (default: noop, subclasses use FlushController). */
  protected scheduleFlush(): void {
    /* default: no-op (subclasses override with FlushController-style debouncing) */
  }

  /** Purge completed tools older than MAX_COMPLETED_TOOL_AGE from active display. */
  protected purgeOldCompletedTools(): void {
    const now = Date.now();
    for (const [id, tool] of this.tools) {
      if (
        tool.status !== 'running' &&
        tool.endTime &&
        now - tool.endTime > MAX_COMPLETED_TOOL_AGE
      ) {
        this.tools.delete(id);
      }
    }
  }

  protected pushEvent(type: string, text?: string): void {
    this.recentEvents.push({ type, timestamp: Date.now(), text });
    if (this.recentEvents.length > MAX_RECENT_EVENTS * 2) {
      // Keep only the most recent 2x display count
      this.recentEvents = this.recentEvents.slice(-MAX_RECENT_EVENTS);
    }
  }
}
