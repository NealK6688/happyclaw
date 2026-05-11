/**
 * src/utils.ts pure-function tests.
 *
 * These small helpers run on every agent reply / IM message, so a regression
 * shows up as the user seeing internal `<internal>...</internal>` blocks or
 * the system spam-replying with maintenance acks.
 */
import { describe, expect, test } from 'vitest';
import {
  stripAgentInternalTags,
  isSystemMaintenanceNoise,
  stripVirtualJidSuffix,
} from '../../src/utils.js';

describe('stripAgentInternalTags', () => {
  test('removes <internal> blocks', () => {
    const input = 'before <internal>secret reasoning</internal> after';
    expect(stripAgentInternalTags(input)).toBe('before  after');
  });

  test('removes <process> blocks', () => {
    const input = 'a <process>progress note</process> b';
    expect(stripAgentInternalTags(input)).toBe('a  b');
  });

  test('removes multiple <internal> blocks', () => {
    const input = '<internal>x</internal>mid<internal>y</internal>end';
    expect(stripAgentInternalTags(input)).toBe('midend');
  });

  test('handles multi-line internal blocks', () => {
    const input = 'hello\n<internal>\n line 1\n line 2\n</internal>\nworld';
    expect(stripAgentInternalTags(input)).toBe('hello\n\nworld');
  });

  test('trims leading/trailing whitespace from final result', () => {
    const input = '<internal>x</internal>\n\nactual content   ';
    expect(stripAgentInternalTags(input)).toBe('actual content');
  });

  test('passes through text without tags', () => {
    const input = 'just some normal text';
    expect(stripAgentInternalTags(input)).toBe(input);
  });

  test('non-greedy match — does not collapse multiple blocks into one', () => {
    const input = '<internal>a</internal> KEEP <internal>b</internal>';
    expect(stripAgentInternalTags(input)).toContain('KEEP');
  });
});

describe('isSystemMaintenanceNoise', () => {
  test('flags short English acks', () => {
    expect(isSystemMaintenanceNoise('ok')).toBe(true);
    expect(isSystemMaintenanceNoise('OK.')).toBe(true);
    expect(isSystemMaintenanceNoise('ok!')).toBe(true);
  });

  test('flags Chinese acks', () => {
    expect(isSystemMaintenanceNoise('好的')).toBe(true);
    expect(isSystemMaintenanceNoise('好的。')).toBe(true);
  });

  test('flags 已更新 / 已完成 / 已刷新 prefixes', () => {
    expect(isSystemMaintenanceNoise('已更新记忆')).toBe(true);
    expect(isSystemMaintenanceNoise('已完成')).toBe(true);
    expect(isSystemMaintenanceNoise('已刷新缓存')).toBe(true);
  });

  test('flags claude.md and memory update notes', () => {
    expect(isSystemMaintenanceNoise('CLAUDE.md 已更新')).toBe(true);
    expect(isSystemMaintenanceNoise('记忆已写入')).toBe(true);
    expect(isSystemMaintenanceNoise('memory flush')).toBe(true);
    expect(isSystemMaintenanceNoise('memory updated')).toBe(true);
  });

  test('long text (>30 chars) is never noise', () => {
    const longAck =
      '已完成所有任务，包括了非常详细的步骤说明，绝对超过三十个字符的范围';
    expect(isSystemMaintenanceNoise(longAck)).toBe(false);
  });

  test('empty / whitespace-only text is noise (suppress empty replies)', () => {
    expect(isSystemMaintenanceNoise('')).toBe(true);
    expect(isSystemMaintenanceNoise('   \n\n  ')).toBe(true);
  });

  test('substantive replies are NOT flagged', () => {
    expect(isSystemMaintenanceNoise('这里是任务的实际进度报告')).toBe(false);
    expect(isSystemMaintenanceNoise('Sure, let me start on that task')).toBe(
      false,
    );
  });

  test('case-insensitive match for English', () => {
    expect(isSystemMaintenanceNoise('Ok!')).toBe(true);
  });
});

describe('stripVirtualJidSuffix', () => {
  test('strips #task: suffix', () => {
    expect(stripVirtualJidSuffix('web:main#task:abc-123')).toBe('web:main');
  });

  test('strips #agent: suffix', () => {
    expect(stripVirtualJidSuffix('feishu:chat-1#agent:agent-xyz')).toBe(
      'feishu:chat-1',
    );
  });

  test('passes through plain JID unchanged', () => {
    expect(stripVirtualJidSuffix('telegram:user-42')).toBe('telegram:user-42');
  });

  test('handles JIDs with both kinds of separators (task wins, scanned first)', () => {
    // Implementation looks for #task: first; if found returns immediately.
    expect(stripVirtualJidSuffix('web:x#task:t1')).toBe('web:x');
    expect(stripVirtualJidSuffix('web:x#agent:a1')).toBe('web:x');
  });

  test('empty string passes through', () => {
    expect(stripVirtualJidSuffix('')).toBe('');
  });
});
