// ============================================================
// Zyrix FinSuite - RBAC (Role-Based Access Control) Service
// Sprint 3 - Permission management
//
// Defines role hierarchy and per-resource permissions.
// Used by middleware to gate API endpoints.
// ============================================================

import { UserRole } from "@prisma/client";

export type Permission =
  // Invoice
  | "invoice:create"
  | "invoice:read"
  | "invoice:update"
  | "invoice:delete"
  | "invoice:send"
  | "invoice:export"
  // Customer
  | "customer:create"
  | "customer:read"
  | "customer:update"
  | "customer:delete"
  | "customer:export"
  // Bank
  | "bank:connect"
  | "bank:read"
  | "bank:sync"
  | "bank:disconnect"
  | "bank:import_csv"
  // Reports
  | "report:read"
  | "report:export"
  // Settings
  | "settings:read"
  | "settings:update"
  | "settings:billing"
  // Users / RBAC
  | "user:invite"
  | "user:read"
  | "user:update"
  | "user:delete"
  | "user:change_role"
  // Security
  | "security:audit_log_read"
  | "security:ip_allowlist_manage"
  // System
  | "system:export_all"
  | "system:dangerous";

/**
 * Permission matrix: which role gets which permissions by default.
 * OWNER has all permissions implicitly.
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [], // wildcard - filled in below
  ADMIN: [
    "invoice:create", "invoice:read", "invoice:update", "invoice:delete", "invoice:send", "invoice:export",
    "customer:create", "customer:read", "customer:update", "customer:delete", "customer:export",
    "bank:connect", "bank:read", "bank:sync", "bank:disconnect", "bank:import_csv",
    "report:read", "report:export",
    "settings:read", "settings:update", "settings:billing",
    "user:invite", "user:read", "user:update", "user:delete", "user:change_role",
    "security:audit_log_read", "security:ip_allowlist_manage",
    "system:export_all",
  ],
  MANAGER: [
    "invoice:create", "invoice:read", "invoice:update", "invoice:send", "invoice:export",
    "customer:create", "customer:read", "customer:update", "customer:export",
    "bank:read", "bank:sync", "bank:import_csv",
    "report:read", "report:export",
    "settings:read",
    "user:invite", "user:read",
    "security:audit_log_read",
  ],
  ACCOUNTANT: [
    "invoice:create", "invoice:read", "invoice:update", "invoice:send", "invoice:export",
    "customer:read", "customer:update",
    "bank:read", "bank:sync", "bank:import_csv",
    "report:read", "report:export",
  ],
  STAFF: [
    "invoice:create", "invoice:read", "invoice:update", "invoice:send",
    "customer:create", "customer:read", "customer:update",
    "bank:read",
    "report:read",
  ],
  VIEWER: [
    "invoice:read",
    "customer:read",
    "bank:read",
    "report:read",
  ],
};

// Owner gets all permissions
const ALL_PERMISSIONS: Permission[] = Array.from(
  new Set(Object.values(ROLE_PERMISSIONS).flat())
);
ROLE_PERMISSIONS.OWNER = [...ALL_PERMISSIONS, "system:dangerous"];

/**
 * Returns the default permission list for a role.
 */
export function getRolePermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if a role has a specific permission.
 * Custom permission overrides (from MerchantUser.permissions JSON) can
 * grant or revoke individual permissions.
 */
export function hasPermission(
  role: UserRole,
  permission: Permission,
  customPermissions?: Record<string, boolean> | null
): boolean {
  // Custom override (revoke)
  if (customPermissions && customPermissions[permission] === false) {
    return false;
  }

  // Custom override (grant)
  if (customPermissions && customPermissions[permission] === true) {
    return true;
  }

  // Owner gets everything
  if (role === "OWNER") return true;

  return getRolePermissions(role).includes(permission);
}

/**
 * Check if a role can manage another role (e.g. OWNER can manage ADMIN,
 * but ADMIN cannot manage OWNER). Used for user invitation/role-change.
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 60,
  ACCOUNTANT: 40,
  STAFF: 20,
  VIEWER: 10,
};

export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * List all permissions a user effectively has, including custom overrides.
 */
export function effectivePermissions(
  role: UserRole,
  customPermissions?: Record<string, boolean> | null
): Permission[] {
  const base = new Set<Permission>(getRolePermissions(role));

  if (customPermissions) {
    for (const [key, granted] of Object.entries(customPermissions)) {
      if (granted) base.add(key as Permission);
      else base.delete(key as Permission);
    }
  }

  return Array.from(base);
}

/**
 * Get a human-readable list of role names for UI dropdowns.
 */
export function listRoles(): Array<{ role: UserRole; label: string; description: string }> {
  return [
    { role: "OWNER" as UserRole, label: "Owner", description: "Full control over the merchant account" },
    { role: "ADMIN" as UserRole, label: "Admin", description: "Manage everything except billing changes" },
    { role: "MANAGER" as UserRole, label: "Manager", description: "Operations and team management" },
    { role: "ACCOUNTANT" as UserRole, label: "Accountant", description: "Invoicing, banking, reports" },
    { role: "STAFF" as UserRole, label: "Staff", description: "Day-to-day invoice and customer work" },
    { role: "VIEWER" as UserRole, label: "Viewer", description: "Read-only access" },
  ];
}
