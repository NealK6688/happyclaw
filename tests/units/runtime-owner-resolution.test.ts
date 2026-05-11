/**
 * runtime-owner.ts tests.
 *
 * Plugin runtime is per-user on the admin-shared `web:main + is_home`
 * workspace. The wrong owner = wrong plugin set materialised → user
 * silently runs with a different admin's plugins.
 *
 * Three code paths share this logic (per src/runtime-owner.ts header):
 *   - processGroupMessages cold-start
 *   - processAgentConversation cold-start
 *   - active IPC injection
 *
 * Drift between them would manifest as plugin leakage between admins, so
 * we pin invariants of the single helper here.
 */
import { describe, expect, test } from 'vitest';
import {
  resolveLatestAdminSenderOverride,
  resolveAdminSharedRuntimeOwner,
  resolvePerMessageRuntimeOwner,
  type RuntimeOwnerCandidateUser,
} from '../../src/runtime-owner.js';

function user(
  id: string,
  overrides: Partial<RuntimeOwnerCandidateUser> = {},
): RuntimeOwnerCandidateUser {
  return { id, status: 'active', role: 'admin', ...overrides };
}

describe('resolveLatestAdminSenderOverride', () => {
  test('returns last admin sender (scan from end)', () => {
    const messages = [
      { sender: 'admin-alice' },
      { sender: 'member-bob' },
      { sender: 'admin-carol' },
    ];
    const users = new Map([
      ['admin-alice', user('admin-alice')],
      ['member-bob', user('member-bob', { role: 'member' })],
      ['admin-carol', user('admin-carol')],
    ]);
    const result = resolveLatestAdminSenderOverride(messages, (id) =>
      users.get(id),
    );
    expect(result).toBe('admin-carol');
  });

  test('skips happyclaw-agent and __system__ senders', () => {
    const messages = [
      { sender: 'admin-alice' },
      { sender: 'happyclaw-agent' },
      { sender: '__system__' },
    ];
    const users = new Map([['admin-alice', user('admin-alice')]]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id)),
    ).toBe('admin-alice');
  });

  test('returns null when no admin in message history', () => {
    const messages = [
      { sender: 'member-bob' },
      { sender: 'member-carol' },
    ];
    const users = new Map([
      ['member-bob', user('member-bob', { role: 'member' })],
      ['member-carol', user('member-carol', { role: 'member' })],
    ]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id)),
    ).toBeNull();
  });

  test('disabled admin is NOT eligible (status filter)', () => {
    const messages = [
      { sender: 'admin-disabled' },
      { sender: 'admin-active' },
    ];
    const users = new Map([
      ['admin-disabled', user('admin-disabled', { status: 'disabled' })],
      ['admin-active', user('admin-active')],
    ]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id)),
    ).toBe('admin-active');
  });

  test('deleted admin is NOT eligible', () => {
    const messages = [{ sender: 'admin-gone' }];
    const users = new Map([
      ['admin-gone', user('admin-gone', { status: 'deleted' })],
    ]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id)),
    ).toBeNull();
  });

  test('unknown sender id (lookup returns undefined) is skipped', () => {
    const messages = [
      { sender: 'mystery-id' },
      { sender: 'admin-real' },
    ];
    const users = new Map([['admin-real', user('admin-real')]]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id) ?? null),
    ).toBe('admin-real');
  });

  test('empty messages array returns null', () => {
    expect(resolveLatestAdminSenderOverride([], () => null)).toBeNull();
  });

  test('empty/missing sender is skipped without crash', () => {
    const messages = [
      { sender: '' },
      { sender: 'admin-real' },
    ];
    const users = new Map([['admin-real', user('admin-real')]]);
    expect(
      resolveLatestAdminSenderOverride(messages, (id) => users.get(id)),
    ).toBe('admin-real');
  });
});

describe('resolveAdminSharedRuntimeOwner', () => {
  test('only applies on web:main + isHome=true', () => {
    const ctx = {
      chatJid: 'web:home-u1',
      isHome: true,
      fallbackOwner: 'fallback-admin',
      messages: [{ sender: 'admin-carol' }],
      getUserById: () => user('admin-carol'),
    };
    // Not web:main → returns fallback unchanged
    expect(resolveAdminSharedRuntimeOwner(ctx)).toBe('fallback-admin');
  });

  test('returns latest admin override on web:main + isHome', () => {
    const result = resolveAdminSharedRuntimeOwner({
      chatJid: 'web:main',
      isHome: true,
      fallbackOwner: 'fallback-admin',
      messages: [{ sender: 'admin-carol' }],
      getUserById: () => user('admin-carol'),
    });
    expect(result).toBe('admin-carol');
  });

  test('falls back when no admin in history on web:main', () => {
    const result = resolveAdminSharedRuntimeOwner({
      chatJid: 'web:main',
      isHome: true,
      fallbackOwner: 'fallback-admin',
      messages: [],
      getUserById: () => null,
    });
    expect(result).toBe('fallback-admin');
  });

  test('virtual JID (web:main#agent:xxx) is treated as web:main base', () => {
    const result = resolveAdminSharedRuntimeOwner({
      chatJid: 'web:main#agent:agent-1',
      isHome: true,
      fallbackOwner: 'fallback',
      messages: [{ sender: 'admin-zoe' }],
      getUserById: () => user('admin-zoe'),
    });
    expect(result).toBe('admin-zoe');
  });

  test('isHome=false on web:main → falls back (gate is AND)', () => {
    expect(
      resolveAdminSharedRuntimeOwner({
        chatJid: 'web:main',
        isHome: false,
        fallbackOwner: 'fallback',
        messages: [{ sender: 'admin-x' }],
        getUserById: () => user('admin-x'),
      }),
    ).toBe('fallback');
  });
});

describe('resolvePerMessageRuntimeOwner', () => {
  test('uses each message sender (not the latest admin) on web:main+isHome', () => {
    const users = new Map([
      ['admin-a', user('admin-a')],
      ['admin-b', user('admin-b')],
    ]);
    expect(
      resolvePerMessageRuntimeOwner({
        chatJid: 'web:main',
        isHome: true,
        fallbackOwner: 'fallback',
        message: { sender: 'admin-a' },
        getUserById: (id) => users.get(id),
      }),
    ).toBe('admin-a');
    expect(
      resolvePerMessageRuntimeOwner({
        chatJid: 'web:main',
        isHome: true,
        fallbackOwner: 'fallback',
        message: { sender: 'admin-b' },
        getUserById: (id) => users.get(id),
      }),
    ).toBe('admin-b');
  });

  test('non-admin sender falls back to workspace owner', () => {
    const users = new Map([
      ['member-c', user('member-c', { role: 'member' })],
    ]);
    expect(
      resolvePerMessageRuntimeOwner({
        chatJid: 'web:main',
        isHome: true,
        fallbackOwner: 'workspace-admin',
        message: { sender: 'member-c' },
        getUserById: (id) => users.get(id),
      }),
    ).toBe('workspace-admin');
  });

  test('system senders return fallback', () => {
    expect(
      resolvePerMessageRuntimeOwner({
        chatJid: 'web:main',
        isHome: true,
        fallbackOwner: 'workspace-admin',
        message: { sender: 'happyclaw-agent' },
        getUserById: () => null,
      }),
    ).toBe('workspace-admin');
  });

  test('non-web:main workspace returns fallback regardless of sender', () => {
    expect(
      resolvePerMessageRuntimeOwner({
        chatJid: 'web:home-u1',
        isHome: true,
        fallbackOwner: 'u1',
        message: { sender: 'admin-other' },
        getUserById: () => user('admin-other'),
      }),
    ).toBe('u1');
  });
});
