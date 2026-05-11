/**
 * channel-prefixes routing tests.
 *
 * The CHANNEL_PREFIXES map is the source of truth for IM-jid → channel
 * dispatch. Every new IM integration must register its prefix here (per
 * CLAUDE.md §10) or replies silently get classified as "web" and never reach
 * the user. Lock this in with explicit cases per known channel + the
 * unknown-prefix fallback.
 */
import { describe, expect, test } from 'vitest';
import {
  CHANNEL_PREFIXES,
  getChannelFromJid,
} from '../../src/channel-prefixes.js';

// Every channel that MUST be registered. Update when adding new integrations.
const REQUIRED_CHANNELS = [
  'feishu',
  'telegram',
  'qq',
  'wechat',
  'dingtalk',
  'discord',
] as const;

describe('CHANNEL_PREFIXES registry', () => {
  test('every required channel has a registered prefix', () => {
    for (const channel of REQUIRED_CHANNELS) {
      expect(CHANNEL_PREFIXES[channel], `missing channel: ${channel}`).toBe(
        `${channel}:`,
      );
    }
  });

  test('every prefix ends with a colon', () => {
    for (const [name, prefix] of Object.entries(CHANNEL_PREFIXES)) {
      expect(prefix.endsWith(':'), `${name} prefix lacks colon`).toBe(true);
    }
  });

  test('prefixes are unique', () => {
    const values = Object.values(CHANNEL_PREFIXES);
    expect(new Set(values).size).toBe(values.length);
  });

  test('prefix base equals the channel name (avoid foo → bar: drift)', () => {
    for (const [name, prefix] of Object.entries(CHANNEL_PREFIXES)) {
      expect(prefix).toBe(`${name}:`);
    }
  });
});

describe('getChannelFromJid', () => {
  test.each(REQUIRED_CHANNELS)('detects %s prefix', (channel) => {
    expect(getChannelFromJid(`${channel}:some-id`)).toBe(channel);
  });

  test('returns "web" for JIDs without any registered prefix', () => {
    expect(getChannelFromJid('web:main')).toBe('web');
    expect(getChannelFromJid('web:home-u1')).toBe('web');
    expect(getChannelFromJid('unknown:xyz')).toBe('web');
  });

  test('returns "web" for empty string', () => {
    expect(getChannelFromJid('')).toBe('web');
  });

  test('virtual JID suffix does not change channel detection', () => {
    expect(getChannelFromJid('feishu:chat#agent:abc')).toBe('feishu');
    expect(getChannelFromJid('telegram:42#task:t1')).toBe('telegram');
    expect(getChannelFromJid('dingtalk:c1#agent:a')).toBe('dingtalk');
  });

  test('case-sensitive matching (FEISHU is not feishu)', () => {
    expect(getChannelFromJid('FEISHU:abc')).toBe('web');
  });

  test('partial prefix (substring) is not a match', () => {
    // "feishu" as suffix or substring should NOT match
    expect(getChannelFromJid('not-feishu:abc')).toBe('web');
  });

  test('discord and wechat JIDs route correctly (newer channels)', () => {
    expect(getChannelFromJid('discord:channel-123')).toBe('discord');
    expect(getChannelFromJid('wechat:wx-user-id')).toBe('wechat');
  });
});

describe('channel routing matrix sanity', () => {
  test('all known JIDs resolve to one of the 7 known channel values', () => {
    const known = new Set([...REQUIRED_CHANNELS, 'web']);
    const samples = [
      'feishu:1',
      'telegram:2',
      'qq:3',
      'wechat:4',
      'dingtalk:5',
      'discord:6',
      'web:main',
      'unknown:7',
      '',
    ];
    for (const jid of samples) {
      expect(known.has(getChannelFromJid(jid))).toBe(true);
    }
  });
});
