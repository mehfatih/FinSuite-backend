// ============================================================
// Zyrix FinSuite - Marketplace Controller
// Track C - Sprint 2 Feature 4
//
// Endpoints (all authenticated):
//   GET    /api/marketplace/providers       list all 20 providers
//   POST   /api/marketplace/connect         create/update connection
//   GET    /api/marketplace/connections     list all merchant connections
//   POST   /api/marketplace/sync/:id        trigger sync for one connection
//   POST   /api/marketplace/sync-all        sync all connected providers
//   GET    /api/marketplace/orders          list orders (filter by provider/status)
//   GET    /api/marketplace/settlements     list settlements (filter by provider)
//   DELETE /api/marketplace/connection/:id  disconnect one provider
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { syncMarketplaceConnection } from "../services/marketplaceReconciliationService";
import { listProviders, getProvider } from "../services/marketplaceCatalog";
import { pid } from "../utils/params";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

const VALID_PROVIDERS = [
  "TRENDYOL","HEPSIBURADA","N11","CICEKSEPETI","PTTAVM",
  "AMAZON_TR","GETIR","FLO","YEMEKSEPETI","VATAN",
  "SALLA","ZID","NOON_SA","AMAZON_SA","JARIR",
  "AMAZON_AE","NOON_AE","NAMSHI","CARREFOUR_AE","MUMZWORLD",
] as const;

const connectSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  sellerId: z.string().trim().min(1).max(100),
  storeName: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().min(1).max(300).optional(),
  apiSecret: z.string().trim().min(1).max(300).optional(),
  region: z.string().trim().max(50).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET /providers
// ----------------------------------------------------------------

export async function providersHandler(_req: Request, res: Response) {
  return ok(res, listProviders());
}

// ----------------------------------------------------------------
// POST /connect
// ----------------------------------------------------------------

export async function connectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  const cfg = getProvider(input.provider);
  if (!cfg) return fail(res, 400, "Unknown provider");

  try {
    const upserted = await prisma.marketplaceConnection.upsert({
      where: {
        merchantId_provider: {
          merchantId: req.merchant.id,
          provider: input.provider as any,
        },
      },
      create: {
        merchantId: req.merchant.id,
        provider: input.provider as any,
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        region: input.region || cfg.country,
        status: "CONNECTED" as any,
      } as any,
      update: {
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        region: input.region || cfg.country,
        status: "CONNECTED" as any,
      } as any,
    });
    return ok(res, upserted, 201);
  } catch (err) {
    return fail(res, 500, "Failed to connect");
  }
}

// ----------------------------------------------------------------
// GET /connections
// ----------------------------------------------------------------

export async function connectionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.marketplaceConnection.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "asc" },
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /sync/:id
// ----------------------------------------------------------------

export async function syncOneHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const conn = await prisma.marketplaceConnection.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!conn) return fail(res, 404, "Connection not found");

  const result = await syncMarketplaceConnection(conn.id);
  if (!result.success) return fail(res, 502, result.error || "Sync failed");
  return ok(res, result);
}

// ----------------------------------------------------------------
// POST /sync-all
// ----------------------------------------------------------------

export async function syncAllHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const conns = await prisma.marketplaceConnection.findMany({
    where: { merchantId: req.merchant.id, status: "CONNECTED" as any },
  });

  const results = [];
  for (const c of conns) {
    const r = await syncMarketplaceConnection(c.id);
    results.push({ provider: c.provider, ...r });
  }

  const totals = results.reduce((acc, r) => ({
    ordersInserted: acc.ordersInserted + (r.ordersInserted || 0),
    settlementsInserted: acc.settlementsInserted + (r.settlementsInserted || 0),
    reconciledCount: acc.reconciledCount + (r.reconciledCount || 0),
  }), { ordersInserted: 0, settlementsInserted: 0, reconciledCount: 0 });

  return ok(res, { results, totals, connectionsProcessed: conns.length });
}

// ----------------------------------------------------------------
// GET /orders
// ----------------------------------------------------------------

export async function ordersHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const provider = String(req.query.provider || "");
  const status = String(req.query.status || "");

  const where: any = { merchantId: req.merchant.id };
  if (provider) where.provider = provider;
  if (status) where.status = status;

  const [rows, total] = await Promise.all([
    prisma.marketplaceOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: 100,
    }),
    prisma.marketplaceOrder.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /settlements
// ----------------------------------------------------------------

export async function settlementsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const provider = String(req.query.provider || "");
  const where: any = { merchantId: req.merchant.id };
  if (provider) where.provider = provider;

  const rows = await prisma.marketplaceSettlement.findMany({
    where,
    orderBy: { periodStart: "desc" },
    take: 100,
  });

  return ok(res, rows);
}

// ----------------------------------------------------------------
// DELETE /connection/:id
// ----------------------------------------------------------------

export async function disconnectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  await prisma.marketplaceConnection.deleteMany({
    where: { id, merchantId: req.merchant.id },
  });
  return ok(res, { disconnected: true });
}
