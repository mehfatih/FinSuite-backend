// ============================================================
// Zyrix FinSuite - Cash Crisis Controller
// Track C - Sprint 2 Feature 2
//
// Endpoints (all authenticated):
//   GET    /api/cash-crisis           list active alerts
//   GET    /api/cash-crisis/all       list including dismissed/resolved
//   POST   /api/cash-crisis/analyze   trigger analysis on demand
//   POST   /api/cash-crisis/:id/dismiss
//   POST   /api/cash-crisis/:id/resolve
// ============================================================

import { Request, Response } from "express";
import { prisma } from "../config/database";
import { analyzeMerchant } from "../services/cashCrisisService";
import { pid } from "../utils/params";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET / - active only
// ----------------------------------------------------------------

export async function listActiveHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.cashCrisisAlert.findMany({
    where: { merchantId: req.merchant.id, status: "ACTIVE" as any },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// GET /all
// ----------------------------------------------------------------

export async function listAllHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.cashCrisisAlert.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /analyze
// ----------------------------------------------------------------

export async function analyzeHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const result = await analyzeMerchant(req.merchant.id);
  if (!result.success) {
    return fail(res, 500, result.error || "Analysis failed");
  }
  return ok(res, result);
}

// ----------------------------------------------------------------
// POST /:id/dismiss
// ----------------------------------------------------------------

export async function dismissHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const existing = await prisma.cashCrisisAlert.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Alert not found");

  const updated = await prisma.cashCrisisAlert.update({
    where: { id },
    data: { status: "DISMISSED" as any, dismissedAt: new Date() } as any,
  });
  return ok(res, updated);
}

// ----------------------------------------------------------------
// POST /:id/resolve
// ----------------------------------------------------------------

export async function resolveHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const existing = await prisma.cashCrisisAlert.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Alert not found");

  const updated = await prisma.cashCrisisAlert.update({
    where: { id },
    data: { status: "RESOLVED" as any, resolvedAt: new Date() } as any,
  });
  return ok(res, updated);
}
