// ============================================================
// Zyrix FinSuite - Sprint 3 Middleware
// RBAC permission gate, IP allowlist enforcement, audit logging
// ============================================================

import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { hasPermission, Permission } from "../services/rbacService";
import { checkIp } from "../services/ipAllowlistService";
import { audit } from "../services/auditService";

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

// ----------------------------------------------------------------
// Helper: extract real client IP (respects trust proxy)
// ----------------------------------------------------------------

function getClientIp(req: Request): string {
  // Express respects trust proxy when app.set('trust proxy', 1) is set
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return String(fwd[0]).split(",")[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

// ----------------------------------------------------------------
// requirePermission: gate an endpoint by permission
//
// Usage:
//   router.post("/invoices", authenticate, requirePermission("invoice:create"), handler);
//
// If req.user is missing, falls back to OWNER role (since req.merchant
// is the account owner). This keeps single-user accounts working.
// ----------------------------------------------------------------

export function requirePermission(permission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role: UserRole = req.user?.role || ("OWNER" as UserRole);
    const customPerms = req.user?.permissions;

    if (!hasPermission(role, permission, customPerms)) {
      // Audit the denial
      if (req.merchant?.id) {
        audit({
          merchantId: req.merchant.id,
          userId: req.user?.id,
          userEmail: req.user?.email || req.merchant.email,
          action: "ERROR" as any,
          resource: "rbac",
          metadata: {
            permission,
            role,
            method: req.method,
            path: req.path,
          },
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"] || undefined,
          success: false,
          errorMessage: "Permission denied: " + permission,
        });
      }

      return res.status(403).json({
        success: false,
        error: "Permission denied: " + permission,
      });
    }

    next();
  };
}

// ----------------------------------------------------------------
// enforceIpAllowlist: block requests from non-allowed IPs
//
// Usage:
//   router.use(authenticate, enforceIpAllowlist);
//
// If merchant has no IP allowlist config or mode is DISABLED, passes through.
// Otherwise checks against entries.
// ----------------------------------------------------------------

export async function enforceIpAllowlist(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.merchant?.id) {
    return next();
  }

  const ip = getClientIp(req);

  try {
    const result = await checkIp(req.merchant.id, ip);
    if (!result.allowed) {
      audit({
        merchantId: req.merchant.id,
        userId: req.user?.id,
        userEmail: req.user?.email || req.merchant.email,
        action: "ERROR" as any,
        resource: "ip_allowlist",
        metadata: {
          ip,
          mode: result.mode,
          reason: result.reason,
          method: req.method,
          path: req.path,
        },
        ipAddress: ip,
        userAgent: req.headers["user-agent"] || undefined,
        success: false,
        errorMessage: "IP blocked: " + (result.reason || "not allowed"),
      });

      return res.status(403).json({
        success: false,
        error: "Access denied from this IP address.",
      });
    }
    return next();
  } catch (err) {
    // Fail open: don't block the user if check fails
    console.error("[ipAllowlist] check failed:", err);
    return next();
  }
}

// ----------------------------------------------------------------
// auditMutation: auto-log mutating requests (POST/PUT/PATCH/DELETE)
//
// Usage:
//   router.use(authenticate, auditMutation("invoice"));
//
// Logs after the response is sent so we know success/failure.
// ----------------------------------------------------------------

export function auditMutation(resource: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return next();
    }

    const startTime = Date.now();

    res.on("finish", () => {
      if (!req.merchant?.id) return;

      const success = res.statusCode < 400;
      const action = req.method === "POST"
        ? "CREATE"
        : req.method === "DELETE"
        ? "DELETE"
        : "UPDATE";

      audit({
        merchantId: req.merchant.id,
        userId: req.user?.id,
        userEmail: req.user?.email || req.merchant.email,
        action: action as any,
        resource,
        resourceId: (req.params.id as string) || (req.params.invoiceId as string) || undefined,
        metadata: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startTime,
        },
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || undefined,
        success,
      });
    });

    next();
  };
}

// ----------------------------------------------------------------
// Helper to manually log from inside handlers
// ----------------------------------------------------------------

export function auditFromRequest(
  req: AuthenticatedRequest,
  data: {
    action: any;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, any>;
    success?: boolean;
    errorMessage?: string;
  }
) {
  if (!req.merchant?.id) return;
  return audit({
    merchantId: req.merchant.id,
    userId: req.user?.id,
    userEmail: req.user?.email || req.merchant.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] || undefined,
    ...data,
  });
}
