/**
 * mount-security pure-function tests.
 *
 * Covers the exported helpers that don't require a real allowlist file:
 *   - expandPath: ~/foo and ~ resolution
 *   - matchesBlockedPattern: path-component-level blacklist matching
 *   - findAllowedRoot: parent-child path containment check
 *
 * These are the building blocks of validateMount — pinning them here lets
 * future refactors of validateMount move logic around without losing the
 * fence behavior (CVE-class: container escapes via mount of .ssh etc.).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import {
  expandPath,
  matchesBlockedPattern,
  findAllowedRoot,
} from '../../src/mount-security.js';
import type { AllowedRoot } from '../../src/types.js';

describe('expandPath', () => {
  test('expands ~/ prefix to home directory', () => {
    const result = expandPath('~/projects/foo');
    expect(result).toBe(path.join(os.homedir(), 'projects/foo'));
  });

  test('expands bare ~ to home directory', () => {
    expect(expandPath('~')).toBe(os.homedir());
  });

  test('absolute paths are passed through to path.resolve', () => {
    expect(expandPath('/tmp/foo')).toBe('/tmp/foo');
  });

  test('relative paths are resolved against cwd', () => {
    const result = expandPath('foo/bar');
    expect(path.isAbsolute(result)).toBe(true);
    expect(result.endsWith('foo/bar')).toBe(true);
  });

  test('~user form is NOT expanded (only ~/ and bare ~)', () => {
    // Documents the intentional limitation — security: avoid surprising
    // user-name expansion through homedir lookup.
    const result = expandPath('~other/foo');
    expect(result).not.toContain(os.homedir() + '/foo');
  });
});

describe('matchesBlockedPattern', () => {
  const defaults = [
    '.ssh',
    '.gnupg',
    '.aws',
    '.kube',
    'credentials',
    '.env',
    '.netrc',
    'id_rsa',
    'id_ed25519',
  ];

  test('exact path-component match blocks .ssh', () => {
    expect(matchesBlockedPattern('/home/user/.ssh/id_rsa', defaults)).toBe(
      '.ssh',
    );
  });

  test('exact path-component match blocks credentials', () => {
    expect(matchesBlockedPattern('/srv/credentials/aws.txt', defaults)).toBe(
      'credentials',
    );
  });

  test('returns null when no component matches', () => {
    expect(matchesBlockedPattern('/home/user/projects/foo', defaults)).toBe(
      null,
    );
  });

  test('partial substring is NOT a match (component-level only)', () => {
    // ".sshrc" or "credentials_test" must not match ".ssh" / "credentials"
    expect(matchesBlockedPattern('/home/user/.sshrc/foo', defaults)).toBe(null);
    expect(
      matchesBlockedPattern('/home/user/credentials_test', defaults),
    ).toBe(null);
  });

  test('blocking is case-sensitive (.SSH does not match .ssh)', () => {
    expect(matchesBlockedPattern('/home/user/.SSH/key', defaults)).toBe(null);
  });

  test('empty pattern list never matches', () => {
    expect(matchesBlockedPattern('/home/user/.ssh', [])).toBe(null);
  });

  test('first matching pattern wins (deterministic)', () => {
    const result = matchesBlockedPattern(
      '/path/.ssh/.env/file',
      ['.env', '.ssh'],
    );
    // .env is checked first because it's first in the list
    expect(result).toBe('.env');
  });
});

describe('findAllowedRoot', () => {
  // Use a tmp dir we control so realpath of root and child are predictable.
  const realTmp = fs.realpathSync(os.tmpdir());

  test('returns the matching root when path is inside it', () => {
    const roots: AllowedRoot[] = [
      { path: realTmp, allowReadWrite: true, description: 'tmp' },
    ];
    // Pass a real path that lives under realTmp — findAllowedRoot doesn't
    // realpath the input, so we feed it post-realpath.
    const subdirReal = path.join(realTmp, 'subdir', 'file');
    const result = findAllowedRoot(subdirReal, roots);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(realTmp);
  });

  test('returns null when path is outside all roots', () => {
    const roots: AllowedRoot[] = [
      { path: realTmp, allowReadWrite: true, description: 'tmp' },
    ];
    // Pick a path guaranteed to be outside tmp
    const outsidePath = '/proc-definitely-not-under-tmp';
    if (path.relative(realTmp, outsidePath).startsWith('..')) {
      const result = findAllowedRoot(outsidePath, roots);
      expect(result).toBeNull();
    }
  });

  test('skips roots that do not exist on disk', () => {
    const roots: AllowedRoot[] = [
      {
        path: '/nonexistent-path-that-should-never-exist-xyz123',
        allowReadWrite: true,
      },
      { path: realTmp, allowReadWrite: false, description: 'fallback' },
    ];
    const result = findAllowedRoot(path.join(realTmp, 'x'), roots);
    expect(result?.path).toBe(realTmp);
  });

  test('empty allowedRoots list returns null', () => {
    expect(findAllowedRoot('/tmp/x', [])).toBeNull();
  });

  test('the exact root path itself counts as inside', () => {
    const roots: AllowedRoot[] = [{ path: realTmp, allowReadWrite: true }];
    // path.relative(realTmp, realTmp) → ''
    const result = findAllowedRoot(realTmp, roots);
    expect(result?.path).toBe(realTmp);
  });

  test('parent path is NOT inside child root (asymmetric containment)', () => {
    // Make a real child of tmp so the root resolves on disk.
    const child = fs.mkdtempSync(path.join(realTmp, 'happyclaw-mount-test-'));
    try {
      const roots: AllowedRoot[] = [{ path: child, allowReadWrite: true }];
      // Pass realTmp itself (a parent) — it is NOT inside child.
      const result = findAllowedRoot(realTmp, roots);
      expect(result).toBeNull();
    } finally {
      fs.rmSync(child, { recursive: true, force: true });
    }
  });
});
