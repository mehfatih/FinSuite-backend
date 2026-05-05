// ============================================================
// Zyrix FinSuite - Sprint 3 Controller
// User management (RBAC), audit log access, IP allowlist
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { UserRole, AuditActionType, IpAllowlistMode } from "@prisma/client";
import { prisma } from "../config/database";
import {
  hasPermission,
  canManageRole,
  effectivePermissions,
  listRoles,
  Permission,
} from "../services/rbacService";
import {
  queryAuditLogs,
  auditSummary,
  audit,
} from "../services/auditService";
import {
  getAllowlistForMerchant,
  setMode,
  addEntry,
  removeEntry,
  toggleEntry,
} from "../services/ipAllowlistService";

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
    language?: string;
  };
  user?: {
    id: string;
    email: string;
    role: UserRole;
    permissions?: Record<string, boolean>;
  };
}

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}
function getIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.ip || "unknown";
}

// ============================================================
// MERCHANT USERS (RBAC)
// ============================================================

const inviteUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().trim().min(2).max(100),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "STAFF", "VIEWER"]),
  password: z.string().min(8).max(100),
  permissions: z.record(z.boolean()).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "STAFF", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
  permissions: z.record(z.boolean()).optional(),
});

export async function listUsersHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const users = await prisma.merchantUser.findMany({
    where: { merchantId: req.merchant.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      acceptedAt: true,
      createdAt: true,
      permissions: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return ok(res, { users, total: users.length });
}

export async function inviteUserHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const actorRole: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(actorRole, "user:invite", req.user?.permissions)) {
    return fail(res, 403, "Permission denied: user:invite");
  }

  const parsed = inviteUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { email, name, role, password, permissions } = parsed.data;

  if (!canManageRole(actorRole, role as UserRole) && actorRole !== "OWNER") {
    return fail(res, 403, "Cannot invite a user with role >= your own");
  }

  const existing = await prisma.merchantUser.findUnique({
    where: { merchantId_email: { merchantId: req.merchant.id, email } },
  });
  if (existing) return fail(res, 409, "User with this email already exists");

  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.merchantUser.create({
    data: {
      merchantId: req.merchant.id,
      email,
      name,
      passwordHash: hash,
      role: role as UserRole,
      invitedBy: req.user?.id || null,
      permissions: (permissions as any) || {},
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  await audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    action: "PERMISSION_CHANGE" as AuditActionType,
    resource: "merchant_user",
    resourceId: user.id,
    metadata: { action: "invite", role: user.role, email: user.email },
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || undefined,
    success: true,
  });

  return ok(res, user, 201);
}

export async function updateUserHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const actorRole: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(actorRole, "user:update", req.user?.permissions)) {
    return fail(res, 403, "Permission denied: user:update");
  }

  const userId = String(req.params.id || "");
  if (!userId) return fail(res, 400, "id required");

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }

  const target = await prisma.merchantUser.findFirst({
    where: { id: userId, merchantId: req.merchant.id },
  });
  if (!target) return fail(res, 404, "User not found");

  // If changing role, validate permission
  if (parsed.data.role && parsed.data.role !== target.role) {
    if (!hasPermission(actorRole, "user:change_role", req.user?.permissions)) {
      return fail(res, 403, "Permission denied: user:change_role");
    }
    if (!canManageRole(actorRole, parsed.data.role as UserRole) && actorRole !== "OWNER") {
      return fail(res, 403, "Cannot assign role >= your own");
    }
  }

  const updated = await prisma.merchantUser.update({
    where: { id: userId },
    data: {
      name: parsed.data.name ?? undefined,
      role: parsed.data.role as UserRole | undefined,
      isActive: parsed.data.isActive ?? undefined,
      permissions: parsed.data.permissions !== undefined ? (parsed.data.permissions as any) : undefined,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      permissions: true,
      updatedAt: true,
    },
  });

  await audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    action: "UPDATE" as AuditActionType,
    resource: "merchant_user",
    resourceId: updated.id,
    metadata: { changes: parsed.data },
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || undefined,
  });

  return ok(res, updated);
}

export async function deleteUserHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const actorRole: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(actorRole, "user:delete", req.user?.permissions)) {
    return fail(res, 403, "Permission denied: user:delete");
  }

  const userId = String(req.params.id || "");
  const target = await prisma.merchantUser.findFirst({
    where: { id: userId, merchantId: req.merchant.id },
  });
  if (!target) return fail(res, 404, "User not found");

  if (!canManageRole(actorRole, target.role) && actorRole !== "OWNER") {
    return fail(res, 403, "Cannot delete a user with role >= your own");
  }

  await prisma.merchantUser.delete({ where: { id: userId } });

  await audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    action: "DELETE" as AuditActionType,
    resource: "merchant_user",
    resourceId: userId,
    metadata: { deletedEmail: target.email, deletedRole: target.role },
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || undefined,
  });

  return ok(res, { id: userId, deleted: true });
}

export async function rolesCatalogHandler(_req: Request, res: Response) {
  return ok(res, { roles: listRoles() });
}

export async function myPermissionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");
  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  const perms = effectivePermissions(role, req.user?.permissions);
  return ok(res, { role, permissions: perms });
}

// ============================================================
// AUDIT LOGS
// ============================================================

const auditQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z
    .enum([
      "CREATE", "READ", "UPDATE", "DELETE",
      "LOGIN", "LOGOUT",
      "EXPORT", "IMPORT",
      "PERMISSION_CHANGE", "SUBSCRIPTION_CHANGE",
      "CONNECTION_CONNECT", "CONNECTION_DISCONNECT",
      "WEBHOOK_RECEIVED", "CRON_RUN", "ERROR",
    ])
    .optional(),
  resource: z.string().max(100).optional(),
  resourceId: z.string().max(100).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  failuresOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
});

export async function listAuditLogsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:audit_log_read", req.user?.permissions)) {
    return fail(res, 403, "Permission denied: security:audit_log_read");
  }

  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }

  const result = await queryAuditLogs({
    merchantId: req.merchant.id,
    ...parsed.data,
    action: parsed.data.action as AuditActionType | undefined,
  });

  return ok(res, result);
}

export async function auditSummaryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:audit_log_read", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const summary = await auditSummary(req.merchant.id, days);
  return ok(res, summary);
}

// ============================================================
// IP ALLOWLIST
// ============================================================

const setModeSchema = z.object({
  mode: z.enum(["DISABLED", "ALLOWLIST", "BLOCKLIST"]),
  enforceFor: z.array(z.string()).optional(),
});

const addEntrySchema = z.object({
  ipAddress: z.string().trim().min(7).max(45),
  description: z.string().max(200).optional(),
});

const toggleEntrySchema = z.object({
  isActive: z.boolean(),
});

export async function getAllowlistHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:ip_allowlist_manage", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const data = await getAllowlistForMerchant(req.merchant.id);
  return ok(res, data);
}

export async function setAllowlistModeHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:ip_allowlist_manage", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const parsed = setModeSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");

  const updated = await setMode(
    req.merchant.id,
    parsed.data.mode as IpAllowlistMode,
    parsed.data.enforceFor || []
  );

  await audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    action: "UPDATE" as AuditActionType,
    resource: "ip_allowlist_config",
    metadata: { mode: parsed.data.mode },
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || undefined,
  });

  return ok(res, updated);
}

export async function addAllowlistEntryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:ip_allowlist_manage", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const parsed = addEntrySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");

  try {
    const entry = await addEntry(
      req.merchant.id,
      parsed.data.ipAddress,
      parsed.data.description,
      req.user?.id
    );

    await audit({
      merchantId: req.merchant.id,
      userId: req.user?.id,
      userEmail: req.user?.email || req.merchant.email,
      action: "CREATE" as AuditActionType,
      resource: "ip_allowlist_entry",
      resourceId: entry.id,
      metadata: { ipAddress: entry.ipAddress },
      ipAddress: getIp(req),
      userAgent: req.headers["user-agent"] || undefined,
    });

    return ok(res, entry, 201);
  } catch (err: any) {
    if (err?.code === "P2002") return fail(res, 409, "IP already in list");
    return fail(res, 500, err?.message || "Failed to add entry");
  }
}

export async function removeAllowlistEntryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:ip_allowlist_manage", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const id = String(req.params.id || "");
  const result = await removeEntry(req.merchant.id, id);

  if (result.count === 0) return fail(res, 404, "Entry not found");

  await audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    action: "DELETE" as AuditActionType,
    resource: "ip_allowlist_entry",
    resourceId: id,
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || undefined,
  });

  return ok(res, { id, deleted: true });
}

export async function toggleAllowlistEntryHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const role: UserRole = req.user?.role || ("OWNER" as UserRole);
  if (!hasPermission(role, "security:ip_allowlist_manage", req.user?.permissions)) {
    return fail(res, 403, "Permission denied");
  }

  const id = String(req.params.id || "");
  const parsed = toggleEntrySchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "isActive boolean required");

  const result = await toggleEntry(req.merchant.id, id, parsed.data.isActive);
  if (result.count === 0) return fail(res, 404, "Entry not found");

  return ok(res, { id, isActive: parsed.data.isActive });
}
