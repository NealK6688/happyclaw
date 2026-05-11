/**
 * RBAC permission helpers (src/permissions.ts).
 *
 * Bugs here = security regressions. Every API route uses hasPermission()
 * to gate access; permission normalization runs on every user save.
 */
import { describe, expect, test } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSION_TEMPLATES,
  ROLE_DEFAULT_PERMISSIONS,
  normalizePermissions,
  getDefaultPermissions,
  resolveTemplate,
  hasPermission,
} from '../../src/permissions.js';

describe('permission registry', () => {
  test('ALL_PERMISSIONS contains the canonical 6 permissions', () => {
    expect(ALL_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'manage_system_config',
        'manage_group_env',
        'manage_users',
        'manage_invites',
        'view_audit_log',
        'manage_billing',
      ]),
    );
    expect(ALL_PERMISSIONS.length).toBe(6);
  });

  test('all PERMISSION_TEMPLATES use valid keys and only known permissions', () => {
    for (const [key, tpl] of Object.entries(PERMISSION_TEMPLATES)) {
      expect(tpl.key).toBe(key);
      for (const p of tpl.permissions) {
        expect(ALL_PERMISSIONS).toContain(p);
      }
    }
  });

  test('admin role default permissions equal ALL_PERMISSIONS', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.admin).toEqual(ALL_PERMISSIONS);
  });

  test('member role default permissions is empty', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.member).toEqual([]);
  });
});

describe('normalizePermissions', () => {
  test('passes through valid permission strings', () => {
    const result = normalizePermissions(['manage_users', 'manage_invites']);
    expect(result).toEqual(
      expect.arrayContaining(['manage_users', 'manage_invites']),
    );
  });

  test('drops unknown strings (silently)', () => {
    const result = normalizePermissions([
      'manage_users',
      'fake_perm',
      'manage_invites',
    ]);
    expect(result).toEqual(
      expect.arrayContaining(['manage_users', 'manage_invites']),
    );
    expect(result).not.toContain('fake_perm');
  });

  test('drops non-string values', () => {
    const result = normalizePermissions([
      'manage_users',
      42,
      null,
      undefined,
      { bad: true },
    ]);
    expect(result).toEqual(['manage_users']);
  });

  test('non-array input returns empty array', () => {
    expect(normalizePermissions(null)).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
    expect(normalizePermissions('manage_users')).toEqual([]);
    expect(normalizePermissions({})).toEqual([]);
  });

  test('deduplicates repeated permissions', () => {
    const result = normalizePermissions([
      'manage_users',
      'manage_users',
      'manage_invites',
    ]);
    expect(result).toHaveLength(2);
  });
});

describe('getDefaultPermissions', () => {
  test('admin gets all permissions', () => {
    expect(getDefaultPermissions('admin')).toEqual(ALL_PERMISSIONS);
  });

  test('member gets empty array', () => {
    expect(getDefaultPermissions('member')).toEqual([]);
  });

  test('returns a fresh copy (mutations don\'t leak back)', () => {
    const perms = getDefaultPermissions('admin');
    perms.push('faked' as never);
    // Calling again should return the canonical list
    expect(getDefaultPermissions('admin')).toEqual(ALL_PERMISSIONS);
  });
});

describe('resolveTemplate', () => {
  test('returns null for undefined / unknown key', () => {
    expect(resolveTemplate(undefined)).toBeNull();
    expect(resolveTemplate('nonexistent' as never)).toBeNull();
  });

  test('admin_full → admin role + all permissions', () => {
    const result = resolveTemplate('admin_full');
    expect(result?.role).toBe('admin');
    expect(result?.permissions).toEqual(ALL_PERMISSIONS);
  });

  test('member_basic → member + empty permissions', () => {
    const result = resolveTemplate('member_basic');
    expect(result?.role).toBe('member');
    expect(result?.permissions).toEqual([]);
  });

  test('ops_manager → member + config/env permissions only', () => {
    const result = resolveTemplate('ops_manager');
    expect(result?.role).toBe('member');
    expect(result?.permissions).toEqual([
      'manage_system_config',
      'manage_group_env',
    ]);
    expect(result?.permissions).not.toContain('manage_users');
  });

  test('user_admin → member + user/invite/audit permissions', () => {
    const result = resolveTemplate('user_admin');
    expect(result?.role).toBe('member');
    expect(result?.permissions).toEqual([
      'manage_users',
      'manage_invites',
      'view_audit_log',
    ]);
  });

  test('returned permissions array is a copy (no shared reference)', () => {
    const result = resolveTemplate('admin_full');
    result?.permissions.push('faked' as never);
    const result2 = resolveTemplate('admin_full');
    expect(result2?.permissions).not.toContain('faked');
  });
});

describe('hasPermission', () => {
  test('admin role always has every permission (bypass)', () => {
    const adminUser = { role: 'admin' as const, permissions: [] };
    for (const p of ALL_PERMISSIONS) {
      expect(hasPermission(adminUser, p)).toBe(true);
    }
  });

  test('member with empty perms gets denied everywhere', () => {
    const memberUser = { role: 'member' as const, permissions: [] };
    for (const p of ALL_PERMISSIONS) {
      expect(hasPermission(memberUser, p)).toBe(false);
    }
  });

  test('member with explicit perm gets only that perm', () => {
    const user = {
      role: 'member' as const,
      permissions: ['manage_users' as const],
    };
    expect(hasPermission(user, 'manage_users')).toBe(true);
    expect(hasPermission(user, 'manage_invites')).toBe(false);
  });

  test('member with all permissions still cannot pretend to be admin', () => {
    // Documents the design: hasPermission is the gate, role separately
    // is checked by route handlers for "admin only" actions like delete user.
    const user = { role: 'member' as const, permissions: [...ALL_PERMISSIONS] };
    expect(hasPermission(user, 'manage_users')).toBe(true);
    expect(user.role).not.toBe('admin'); // (sanity: caller can still see role)
  });
});
