// ============================================================
// Zyrix FinSuite - Audit Log Service
// Sprint 3 - Compliance and security tracking
//
// Records every important action for audit trail.
// Used by middleware (auto-log) and explicit calls from handlers.
// ============================================================

import { AuditActionType } from "@prisma/client";
import { prisma } from "../config/database";

export interface AuditEvent {
  merchantId: string;
  userId?: string;
  userEmail?: string;
  action: AuditActionType;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Record an audit event. Non-blocking - errors are logged but never thrown.
 * Use this from inside handlers right after the action succeeds.
 */
export async function audit(event: AuditEvent): Promise<void> {
  try {
    await prisma.merchantAuditLog.create({
      data: {
        merchantId: event.merchantId,
        userId: event.userId || null,
        userEmail: event.userEmail || null,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId || null,
        metadata: (event.metadata as any) || null,
        ipAddress: event.ipAddress || null,
        userAgent: event.userAgent || null,
        success: event.success !== false,
        errorMessage: event.errorMessage || null,
      },
    });
  } catch (err) {
    // Never break the main flow due to audit logging failure
    console.error("[audit] failed to log event:", err);
  }
}

export interface AuditQueryOptions {
  merchantId: string;
  userId?: string;
  action?: AuditActionType;
  resource?: string;
  resourceId?: string;
  fromDate?: Date;
  toDate?: Date;
  successOnly?: boolean;
  failuresOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function queryAuditLogs(opts: AuditQueryOptions) {
  const where: any = { merchantId: opts.merchantId };

  if (opts.userId) where.userId = opts.userId;
  if (opts.action) where.action = opts.action;
  if (opts.resource) where.resource = opts.resource;
  if (opts.resourceId) where.resourceId = opts.resourceId;
  if (opts.successOnly) where.success = true;
  if (opts.failuresOnly) where.success = false;
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }

  const [rows, total] = await Promise.all([
    prisma.merchantAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.merchantAuditLog.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Get audit summary statistics for a merchant.
 */
export async function auditSummary(merchantId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totalEvents, byAction, failures, recentLogins] = await Promise.all([
    prisma.merchantAuditLog.count({
      where: { merchantId, createdAt: { gte: since } },
    }),
    prisma.merchantAuditLog.groupBy({
      by: ["action"],
      where: { merchantId, createdAt: { gte: since } },
      _count: true,
    }),
    prisma.merchantAuditLog.count({
      where: { merchantId, success: false, createdAt: { gte: since } },
    }),
    prisma.merchantAuditLog.findMany({
      where: { merchantId, action: "LOGIN" as any, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { userEmail: true, ipAddress: true, success: true, createdAt: true },
    }),
  ]);

  return {
    totalEvents,
    failures,
    byAction: byAction.map((g) => ({ action: g.action, count: g._count })),
    recentLogins,
    periodDays: days,
  };
}
