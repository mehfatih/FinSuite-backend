// ================================================================
// Phase 14 — Impersonation controller.
// POST /api/admin/customers/:customerId/impersonate  (admin token)
// POST /api/admin/impersonation/exit                 (customer impersonation token)
// GET  /api/admin/impersonation/status               (customer impersonation token)
// ================================================================
import { Request, Response, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AdminRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// Customer JWT shape mirrors authController.login —
// auth middleware reads decoded.id / .email / .plan / etc.
interface ImpersonationClaims {
  id: string;
  email: string;
  plan: string;
  language?: string;
  currency?: string;
  isImpersonation: true;
  impersonationSessionId: string;
  originalAdminId: string;
  originalAdminEmail: string;
}

export const adminImpersonationController = {
  // ── Start impersonation (admin auth required) ──
  start: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const adminId    = req.admin?.id;
      const adminEmail = req.admin?.email;
      if (!adminId || !adminEmail) {
        res.status(401).json({ success: false, error: "Admin authentication required" });
        return;
      }

      const customerId = String(req.params.customerId ?? "");
      const { reason, durationMinutes = 30 } = (req.body || {}) as {
        reason?: string;
        durationMinutes?: number;
      };

      if (!reason || reason.trim().length < 10) {
        res.status(400).json({ success: false, error: "A justification of at least 10 characters is required." });
        return;
      }
      if (![15, 30, 60].includes(durationMinutes)) {
        res.status(400).json({ success: false, error: "Duration must be 15, 30, or 60 minutes." });
        return;
      }

      const merchant = await prisma.merchant.findUnique({
        where: { id: customerId },
        select: {
          id: true, name: true, email: true, plan: true,
          language: true, currency: true, status: true,
        },
      });
      if (!merchant) {
        res.status(404).json({ success: false, error: "Customer not found." });
        return;
      }

      const sessionId = randomUUID();
      const startedAt = new Date();
      const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

      // Raw SQL bypasses Prisma client schema validation — guards against a
      // stale generated client whose model definition predates the migration.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "impersonation_sessions" (
           "id", "adminUserId", "adminEmail", "customerUserId", "targetCustomerName",
           "reason", "durationMinutes", "startedAt", "expiresAt", "ipAddress", "userAgent"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        sessionId,
        adminId,
        adminEmail,
        merchant.id,
        merchant.name,
        reason.trim(),
        durationMinutes,
        startedAt,
        expiresAt,
        req.ip ?? null,
        req.get("user-agent") ?? null
      );

      const session = { id: sessionId, startedAt, expiresAt };

      const claims: ImpersonationClaims = {
        id:                     merchant.id,
        email:                  merchant.email,
        plan:                   merchant.plan as any,
        language:               merchant.language as any,
        currency:               merchant.currency as any,
        isImpersonation:        true,
        impersonationSessionId: session.id,
        originalAdminId:        adminId,
        originalAdminEmail:     adminEmail,
      };

      const customerToken = jwt.sign(
        claims as unknown as Record<string, unknown>,
        env.jwtSecret,
        { expiresIn: `${durationMinutes}m` } as any
      );

      // Best-effort audit log entry (existing AuditLog schema).
      await prisma.auditLog.create({
        data: {
          adminId,
          action:       "admin.impersonation.started",
          targetType:   "customer",
          targetId:     merchant.id,
          resourceType: "customer",
          resourceId:   merchant.id,
          ipAddress:    req.ip ?? null,
          userAgent:    req.get("user-agent") ?? null,
          details: {
            sessionId: session.id,
            adminEmail,
            targetCustomerName: merchant.name,
            reason: reason.trim(),
            durationMinutes,
            severity: "WARNING",
          } as any,
        },
      }).catch(() => undefined);

      res.status(200).json({
        success: true,
        data: {
          sessionId:     session.id,
          customerToken,
          expiresAt:     session.expiresAt,
          target: {
            id:    merchant.id,
            name:  merchant.name,
            email: merchant.email,
          },
        },
      });
    } catch (err: any) {
      console.error("[admin/impersonate start] error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to start impersonation" });
    }
  }),

  // ── Exit impersonation (uses the customer impersonation JWT) ──
  exit: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) {
        res.status(401).json({ success: false, error: "No token provided" });
        return;
      }

      let claims: any;
      try {
        claims = jwt.verify(token, env.jwtSecret);
      } catch {
        res.status(401).json({ success: false, error: "Invalid token" });
        return;
      }

      if (!claims?.isImpersonation || !claims?.impersonationSessionId) {
        res.status(400).json({ success: false, error: "Not in an impersonation session." });
        return;
      }

      await prisma.$executeRawUnsafe(
        `UPDATE "impersonation_sessions"
         SET "endedAt" = $1, "endReason" = $2
         WHERE "id" = $3`,
        new Date(),
        "admin_exit",
        claims.impersonationSessionId
      ).catch(() => undefined);

      await prisma.auditLog.create({
        data: {
          adminId:      claims.originalAdminId,
          action:       "admin.impersonation.ended",
          targetType:   "session",
          targetId:     claims.impersonationSessionId,
          resourceType: "session",
          resourceId:   claims.impersonationSessionId,
          ipAddress:    req.ip ?? null,
          userAgent:    req.get("user-agent") ?? null,
          details: {
            adminEmail: claims.originalAdminEmail,
            endReason:  "admin_exit",
            severity:   "INFO",
          } as any,
        },
      }).catch(() => undefined);

      res.status(200).json({ success: true, data: { ok: true } });
    } catch (err: any) {
      console.error("[admin/impersonate exit] error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to exit impersonation" });
    }
  }),

  // ── Status (banner polls this) ──
  status: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) {
        res.status(200).json({ success: true, data: { active: false } });
        return;
      }

      let claims: any;
      try {
        claims = jwt.verify(token, env.jwtSecret);
      } catch {
        res.status(200).json({ success: true, data: { active: false } });
        return;
      }

      if (!claims?.isImpersonation) {
        res.status(200).json({ success: true, data: { active: false } });
        return;
      }

      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "targetCustomerName", "customerUserId", "expiresAt",
                "endedAt", "adminEmail", "reason"
         FROM "impersonation_sessions"
         WHERE "id" = $1
         LIMIT 1`,
        claims.impersonationSessionId
      );
      const session = rows?.[0];
      if (!session || session.endedAt) {
        res.status(200).json({ success: true, data: { active: false } });
        return;
      }
      if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
        res.status(200).json({ success: true, data: { active: false, expired: true } });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          active:             true,
          sessionId:          session.id,
          targetCustomerName: session.targetCustomerName ?? "",
          targetCustomerId:   session.customerUserId,
          expiresAt:          session.expiresAt,
          adminEmail:         session.adminEmail ?? claims.originalAdminEmail,
          reason:             session.reason,
        },
      });
    } catch (err: any) {
      console.error("[admin/impersonate status] error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to read impersonation status" });
    }
  }),
};
