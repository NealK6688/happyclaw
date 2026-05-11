/**
 * file-manager path safety tests.
 *
 * These cover the path traversal defense and the system-path guard. The
 * file-manager routes (src/routes/files.ts) all feed user input through
 * validateAndResolvePath, so a regression here = directory escape vulnerability.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

// Pin a single tmp dir at module load so GROUPS_DIR captures it deterministically.
const TMP_ROOT =
  process.env.HAPPYCLAW_TEST_FM_DATA_DIR ??
  (() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'happyclaw-fm-'));
    process.env.HAPPYCLAW_TEST_FM_DATA_DIR = d;
    return d;
  })();

vi.mock('../../src/config.js', () => {
  const dataDir = process.env.HAPPYCLAW_TEST_FM_DATA_DIR!;
  return {
    DATA_DIR: dataDir,
    STORE_DIR: path.join(dataDir, 'db'),
    GROUPS_DIR: path.join(dataDir, 'groups'),
    MAIN_GROUP_FOLDER: 'main',
    TIMEZONE: 'UTC',
    ASSISTANT_NAME: 'HappyClaw',
    POLL_INTERVAL: 2000,
    SCHEDULER_POLL_INTERVAL: 60000,
    CONTAINER_IMAGE: 'happyclaw-agent:test',
    WEB_PORT: 3000,
    TRUST_PROXY: false,
    MOUNT_ALLOWLIST_PATH: path.join(dataDir, 'config', 'mount-allowlist.json'),
  };
});

vi.mock('../../src/runtime-config.js', () => ({
  deleteContainerEnvConfig: () => {},
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

const fm = await import('../../src/file-manager.js');
const { validateAndResolvePath, isSystemPath, getFileRoot } = fm;

beforeEach(() => {
  // Wipe contents but keep the path
  if (fs.existsSync(TMP_ROOT)) {
    for (const entry of fs.readdirSync(TMP_ROOT)) {
      fs.rmSync(path.join(TMP_ROOT, entry), { recursive: true, force: true });
    }
  }
  // Seed groups/test-group dir
  fs.mkdirSync(path.join(TMP_ROOT, 'groups', 'test-group'), { recursive: true });
});

afterAll(() => {
  if (TMP_ROOT && fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

describe('getFileRoot', () => {
  test('default resolves under GROUPS_DIR / folder', () => {
    expect(getFileRoot('test-group')).toBe(
      path.join(TMP_ROOT, 'groups', 'test-group'),
    );
  });

  test('rootOverride (absolute) takes precedence', () => {
    expect(getFileRoot('test-group', '/abs/custom/path')).toBe(
      '/abs/custom/path',
    );
  });

  test('rootOverride must be absolute — relative falls through to default', () => {
    expect(getFileRoot('test-group', 'relative/path')).toBe(
      path.join(TMP_ROOT, 'groups', 'test-group'),
    );
  });
});

describe('validateAndResolvePath', () => {
  test('accepts empty relative path (root)', () => {
    const result = validateAndResolvePath('test-group', '');
    expect(result).toBe(path.join(TMP_ROOT, 'groups', 'test-group'));
  });

  test('accepts simple subpath', () => {
    const result = validateAndResolvePath('test-group', 'foo/bar.txt');
    expect(result).toBe(
      path.join(TMP_ROOT, 'groups', 'test-group', 'foo', 'bar.txt'),
    );
  });

  test('rejects ../ escape', () => {
    expect(() =>
      validateAndResolvePath('test-group', '../../etc/passwd'),
    ).toThrow(/Path traversal/);
  });

  test('rejects deep ../../ escape', () => {
    expect(() =>
      validateAndResolvePath('test-group', '../../../../../etc/passwd'),
    ).toThrow(/Path traversal/);
  });

  test('rejects encoded escape via normalized path', () => {
    // foo/../../bar resolves to ../bar
    expect(() => validateAndResolvePath('test-group', 'foo/../../bar')).toThrow(
      /Path traversal/,
    );
  });

  test('accepts ./ self-reference', () => {
    expect(() => validateAndResolvePath('test-group', './foo')).not.toThrow();
  });

  test('rejects symlink escape (parent symlink to outside)', () => {
    if (process.platform === 'win32') return; // symlink semantics differ
    const root = path.join(TMP_ROOT, 'groups', 'test-group');
    const outsideDir = fs.mkdtempSync(path.join(TMP_ROOT, 'outside-'));
    fs.symlinkSync(outsideDir, path.join(root, 'evil-link'));
    expect(() => validateAndResolvePath('test-group', 'evil-link')).toThrow(
      /Symlink traversal/,
    );
    expect(() =>
      validateAndResolvePath('test-group', 'evil-link/file.txt'),
    ).toThrow(/Symlink traversal/);
  });

  test('rootOverride is honoured for path resolution', () => {
    const customRoot = fs.mkdtempSync(path.join(TMP_ROOT, 'custom-'));
    const result = validateAndResolvePath(
      'test-group',
      'sub/file.txt',
      customRoot,
    );
    expect(result).toBe(path.join(customRoot, 'sub', 'file.txt'));
  });
});

describe('isSystemPath', () => {
  test('logs/ is system', () => {
    expect(isSystemPath('logs')).toBe(true);
    expect(isSystemPath('logs/foo.log')).toBe(true);
  });

  test('CLAUDE.md is system', () => {
    expect(isSystemPath('CLAUDE.md')).toBe(true);
  });

  test('.claude/ is system', () => {
    expect(isSystemPath('.claude')).toBe(true);
    expect(isSystemPath('.claude/session.json')).toBe(true);
  });

  test('conversations/ is system', () => {
    expect(isSystemPath('conversations')).toBe(true);
    expect(isSystemPath('conversations/2026-01.json')).toBe(true);
  });

  test('regular files are not system', () => {
    expect(isSystemPath('notes.md')).toBe(false);
    expect(isSystemPath('src/foo.ts')).toBe(false);
    expect(isSystemPath('data/file.json')).toBe(false);
  });

  test('empty path returns false', () => {
    expect(isSystemPath('')).toBe(false);
  });

  test('. alone is not a system path (root marker handled elsewhere)', () => {
    expect(isSystemPath('.')).toBe(false);
  });

  test('similarly-named non-system paths are NOT flagged', () => {
    // "logs" exact match, "logs.txt" or "my-logs" do not
    expect(isSystemPath('logs.txt')).toBe(false);
    expect(isSystemPath('my-logs')).toBe(false);
    expect(isSystemPath('CLAUDE.txt')).toBe(false);
  });

  test('child directory of CLAUDE.md sentinel is not protected (CLAUDE.md is a file)', () => {
    // The first-segment match catches CLAUDE.md/anything as system though,
    // documenting the actual behavior (defensive over-block).
    expect(isSystemPath('CLAUDE.md/foo')).toBe(true);
  });
});
