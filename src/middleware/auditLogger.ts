// ================================================================
// Phase 13 — Audit logger Express middleware.
// Wraps res.json so every authenticated mutation is recorded.
// Maps METHOD + path → action token (e.g., POST /api/invoices → 'invoice.created').
// Skips read-only GETs to keep volume manageable.
// ================================================================
import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const PATH_TO_RESOURCE: { pattern: RegExp; resource: string }[] = [
  { pattern: /^\/api\/invoices/,            resource: "invoice" },
  { pattern: /^\/api\/customers/,           resource: "customer" },
  { pattern: /^\/api\/efatura/,             resource: "efatura" },
  { pattern: /^\/api\/banks/,               resource: "bank" },
  { pattern: /^\/api\/personnel/,           resource: "personnel" },
  { pattern: /^\/api\/security/,            resource: "security" },
  { pattern: /^\/api\/migration/,           resource: "migration" },
  { pattern: /^\/api\/exports/,             resource: "export" },
  { pattern: /^\/api\/support/,             resource: "support" },
  { pattern: /^\/api\/profile/,             resource: "profile" },
];

const METHOD_TO_VERB: Record<string, string> = {
  POST:   "created",
  PATCH:  "updated",
  PUT:    "updated",
  DELETE: "deleted",
};

function deriveAction(method: string, path: string): string | null {
  if (method === "GET") return null;
  if (method === "OPTIONS") return null;
  const verb = METHOD_TO_VERB[method] || method.toLowerCase();
  for (const { pattern, resource } of PATH_TO_RESOURCE) {
    if (pattern.test(path)) {
      return `${resource}.${verb}`;
    }
  }
  return null;
}

export const auditLogger = (req: Request, res: Response, next: NextFunction) => {
  const action = deriveAction(req.method, req.path);
  if (!action) return next();

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    // Only log on success
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        const auth = req as AuthenticatedRequest;
        const merchantId = auth.merchant?.id;
        const userId = auth.merchant?.userId || auth.merchant?.id;
        if (merchantId && userId) {
          // Fire-and-forget — don't block the response
          prisma.auditLog
            .create({
              data: {
                merchantId,
                userId,
                action,
                resourceType: action.split(".")[0],
                resourceId: body?.id || body?.data?.id || req.params?.id || null,
                metadata: {
                  method: req.method,
                  path: req.originalUrl || req.url,
                  statusCode: res.statusCode,
                },
                ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip,
                userAgent: req.headers["user-agent"] || null,
              },
            })
            .catch(() => {});
        }
      } catch { /* swallow — never break the response */ }
    }
    return originalJson(body);
  };

  next();
};

export default auditLogger;
