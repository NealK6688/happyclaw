/**
 * SQLite migration / schema integrity tests for v37.
 *
 * Smoke-tests `initDatabase()` against a fresh tmp DATA_DIR to ensure:
 *   - schema_version row is written with the current SCHEMA_VERSION
 *   - all 27 expected tables exist
 *   - key indexes exist
 *   - running init twice is idempotent (no errors, no row duplication)
 *
 * Goal: catch accidentally-deleted migration steps before they ship.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';

// db.ts captures STORE_DIR at module load — set up a single tmp dir for the
// whole file. Each test wipes the contents but the path stays constant.
const TMP_ROOT =
  process.env.HAPPYCLAW_TEST_DB_DATA_DIR ??
  (() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'happyclaw-db-'));
    process.env.HAPPYCLAW_TEST_DB_DATA_DIR = d;
    return d;
  })();

vi.mock('../../src/config.js', () => {
  const dataDir = process.env.HAPPYCLAW_TEST_DB_DATA_DIR!;
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
  };
});

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

beforeEach(() => {
  // Wipe contents but keep the path so STORE_DIR in cached module still works.
  if (fs.existsSync(TMP_ROOT)) {
    for (const entry of fs.readdirSync(TMP_ROOT)) {
      fs.rmSync(path.join(TMP_ROOT, entry), { recursive: true, force: true });
    }
  }
});

afterAll(() => {
  if (TMP_ROOT && fs.existsSync(TMP_ROOT)) {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

const tmpDataDir = TMP_ROOT;

/** List of tables guaranteed to exist after v37 init (per CLAUDE.md §5). */
const EXPECTED_TABLES = [
  'chats',
  'messages',
  'scheduled_tasks',
  'task_run_logs',
  'router_state',
  'sessions',
  'registered_groups',
  'im_context_bindings',
  'users',
  'user_sessions',
  'invite_codes',
  'auth_audit_log',
  'group_members',
  'user_pinned_groups',
  'agents',
  'usage_records',
  'usage_daily_summary',
  'daily_usage',
  'monthly_usage',
  'user_quotas',
  'user_balances',
  'user_subscriptions',
  'balance_transactions',
  'billing_plans',
  'billing_audit_log',
  'redeem_codes',
  'redeem_code_usage',
];

describe('initDatabase — v37 schema integrity', () => {
  test('creates schema_version=37 and all expected tables', async () => {
    const dbMod = await import('../../src/db.js');
    dbMod.initDatabase();

    const dbPath = path.join(tmpDataDir, 'db', 'messages.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath);
    try {
      // 1. Schema version row
      const versionRow = db
        .prepare('SELECT value FROM router_state WHERE key = ?')
        .get('schema_version') as { value: string } | undefined;
      expect(versionRow?.value).toBe('37');

      // 2. All expected tables exist
      const tableNames = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);

      for (const expected of EXPECTED_TABLES) {
        expect(tableNames, `missing table: ${expected}`).toContain(expected);
      }

      // 3. Key indexes exist
      const indexNames = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);

      expect(indexNames).toContain('idx_messages_jid_ts');
      expect(indexNames).toContain('idx_next_run');
      expect(indexNames).toContain('idx_status');
      expect(indexNames).toContain('idx_task_run_logs');
    } finally {
      db.close();
    }
  });

  test('schema column counts match the v37 surface', async () => {
    const dbMod = await import('../../src/db.js');
    dbMod.initDatabase();

    const dbPath = path.join(tmpDataDir, 'db', 'messages.db');
    const db = new Database(dbPath);
    try {
      // messages table should have the full v37 column set
      const messagesColumns = (
        db.prepare("PRAGMA table_info('messages')").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);

      // Required v37 message columns (per CLAUDE.md §5)
      for (const col of [
        'id',
        'chat_jid',
        'sender',
        'content',
        'timestamp',
        'is_from_me',
        'attachments',
        'token_usage',
        'turn_id',
        'session_id',
      ]) {
        expect(messagesColumns).toContain(col);
      }

      // sessions table must have provider_id (the migration described in db.ts)
      const sessionsColumns = (
        db.prepare("PRAGMA table_info('sessions')").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      expect(sessionsColumns).toContain('provider_id');
      expect(sessionsColumns).toContain('agent_id');

      // registered_groups must have the v37 columns
      const groupsColumns = (
        db.prepare("PRAGMA table_info('registered_groups')").all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      for (const col of ['jid', 'name', 'folder', 'added_at', 'created_by', 'is_home']) {
        expect(groupsColumns).toContain(col);
      }
    } finally {
      db.close();
    }
  });

  test('running initDatabase() twice is idempotent (no duplicate schema rows)', async () => {
    const dbMod = await import('../../src/db.js');
    dbMod.initDatabase();
    // Calling again should not throw
    expect(() => dbMod.initDatabase()).not.toThrow();

    const dbPath = path.join(tmpDataDir, 'db', 'messages.db');
    const db = new Database(dbPath);
    try {
      const rows = db
        .prepare('SELECT value FROM router_state WHERE key = ?')
        .all('schema_version');
      expect(rows).toHaveLength(1); // INSERT OR REPLACE keeps it at 1
      expect((rows[0] as { value: string }).value).toBe('37');
    } finally {
      db.close();
    }
  });

  test('WAL mode is enabled', async () => {
    const dbMod = await import('../../src/db.js');
    dbMod.initDatabase();

    const dbPath = path.join(tmpDataDir, 'db', 'messages.db');
    const db = new Database(dbPath);
    try {
      const mode = (
        db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      ).journal_mode;
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  test('primary keys are set correctly on critical tables', async () => {
    const dbMod = await import('../../src/db.js');
    dbMod.initDatabase();

    const dbPath = path.join(tmpDataDir, 'db', 'messages.db');
    const db = new Database(dbPath);
    try {
      // messages PK is composite (id, chat_jid)
      const messagesPk = (
        db.prepare("PRAGMA table_info('messages')").all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .map((c) => c.name);
      expect(messagesPk).toEqual(expect.arrayContaining(['id', 'chat_jid']));

      // sessions PK is composite (group_folder, agent_id)
      const sessionsPk = (
        db.prepare("PRAGMA table_info('sessions')").all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .map((c) => c.name);
      expect(sessionsPk).toEqual(
        expect.arrayContaining(['group_folder', 'agent_id']),
      );

      // chats PK is jid
      const chatsPk = (
        db.prepare("PRAGMA table_info('chats')").all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .map((c) => c.name);
      expect(chatsPk).toEqual(['jid']);

      // users PK is id
      const usersPk = (
        db.prepare("PRAGMA table_info('users')").all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((c) => c.pk > 0)
        .map((c) => c.name);
      expect(usersPk).toEqual(['id']);
    } finally {
      db.close();
    }
  });
});
