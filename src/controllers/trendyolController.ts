// ============================================================
// Zyrix FinSuite - Trendyol Controller
// Track C - Sprint 2 Feature 3
//
// Endpoints (all authenticated):
//   POST   /api/trendyol/connect          create connection
//   GET    /api/trendyol/connection       current connection
//   POST   /api/trendyol/sync             trigger sync
//   GET    /api/trendyol/orders           list orders
//   GET    /api/trendyol/settlements      list settlements
//   DELETE /api/trendyol/connection       disconnect
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { syncTrendyolConnection } from "../services/trendyolReconciliationService";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

const connectSchema = z.object({
  sellerId: z.string().trim().min(1).max(50),
  apiKey: z.string().trim().min(1).max(200).optional(),
  apiSecret: z.string().trim().min(1).max(200).optional(),
  storeName: z.string().trim().max(200).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /connect - create or update Trendyol connection
// ----------------------------------------------------------------

export async function connectHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  try {
    const upserted = await prisma.trendyolConnection.upsert({
      where: { merchantId: req.merchant.id },
      create: {
        merchantId: req.merchant.id,
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        status: "CONNECTED" as any,
      } as any,
      update: {
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        status: "CONNECTED" as any,
      } as any,
    });
    return ok(res, upserted, 201);
  } catch (err) {
    return fail(res, 500, "Failed to connect");
  }
}

// ----------------------------------------------------------------
// GET /connection - current connection
// ----------------------------------------------------------------

export async function connectionHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const conn = await prisma.trendyolConnection.findUnique({
    where: { merchantId: req.merchant.id },
  });
  return ok(res, conn);
}

// ----------------------------------------------------------------
// POST /sync
// ----------------------------------------------------------------

export async function syncHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const conn = await prisma.trendyolConnection.findUnique({
    where: { merchantId: req.merchant.id },
  });
  if (!conn) return fail(res, 404, "No Trendyol connection. Connect first.");

  const result = await syncTrendyolConnection(conn.id);
  if (!result.success) {
    return fail(res, 502, result.error || "Sync failed");
  }
  return ok(res, result);
}

// ----------------------------------------------------------------
// GET /orders
// ----------------------------------------------------------------

export async function ordersHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const status = String(req.query.status || "");
  const where: any = { merchantId: req.merchant.id };
  if (status) where.status = status;

  const [rows, total] = await Promise.all([
    prisma.trendyolOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: 100,
    }),
    prisma.trendyolOrder.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /settlements
// ----------------------------------------------------------------

export async function settlementsHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.trendyolSettlement.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { periodStart: "desc" },
    take: 50,
  });

  return ok(res, rows);
}

// ----------------------------------------------------------------
// DELETE /connection
// ----------------------------------------------------------------

export async function disconnectHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  await prisma.trendyolConnection.deleteMany({
    where: { merchantId: req.merchant.id },
  });
  return ok(res, { disconnected: true });
}
