// ============================================================
// Zyrix FinSuite - Bank Controller
// Sprint 1 Phase 1B
//
// Endpoints (all authenticated):
//   GET    /api/banks/providers           list supported providers
//   POST   /api/banks/connect             create a BankConnection
//   GET    /api/banks/connections         list connections
//   POST   /api/banks/connections/:id/sync  trigger sync
//   GET    /api/banks/transactions        list transactions
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { listBankProviders } from "../services/bankProviderRegistry";
import { syncConnection } from "../services/bankSyncService";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

const connectSchema = z.object({
  provider: z.enum([
    "GARANTI",
    "IS_BANKASI",
    "YAPI_KREDI",
    "AKBANK",
    "ZIRAAT",
    "OTHER",
  ]),
  accountHolder: z.string().min(2).max(200),
  accountNumber: z.string().max(40).optional(),
  iban: z.string().max(34).optional(),
  currency: z.string().length(3).optional(),
  branchCode: z.string().max(20).optional(),
  branchName: z.string().max(100).optional(),
});

const txnListSchema = z.object({
  connectionId: z.string().uuid().optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET /api/banks/providers
// ----------------------------------------------------------------

export async function providersHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");
  return ok(res, listBankProviders());
}

// ----------------------------------------------------------------
// POST /api/banks/connect
// ----------------------------------------------------------------

export async function connectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  try {
    const created = await prisma.bankConnection.create({
      data: {
        merchantId: req.merchant.id,
        provider: input.provider as any,
        accountHolder: input.accountHolder,
        accountNumber: input.accountNumber || null,
        iban: input.iban || null,
        currency: input.currency || "TRY",
        branchCode: input.branchCode || null,
        branchName: input.branchName || null,
        status: "CONNECTED" as any, // sandbox mode auto-connects
      } as any,
    });
    return ok(res, created, 201);
  } catch (err: any) {
    if (err && err.code === "P2002") {
      return fail(res, 409, "IBAN already linked to another connection");
    }
    return fail(res, 500, "Failed to create bank connection");
  }
}

// ----------------------------------------------------------------
// GET /api/banks/connections
// ----------------------------------------------------------------

export async function connectionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.bankConnection.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /api/banks/connections/:id/sync
// ----------------------------------------------------------------

export async function syncHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const conn = await prisma.bankConnection.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!conn) return fail(res, 404, "Connection not found");

  const result = await syncConnection(id);
  if (!result.success) {
    return fail(res, 502, result.error || "Sync failed");
  }
  return ok(res, result);
}

// ----------------------------------------------------------------
// GET /api/banks/transactions
// ----------------------------------------------------------------

export async function transactionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = txnListSchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }
  const { connectionId, direction, limit, offset } = parsed.data;

  const where: any = { merchantId: req.merchant.id };
  if (connectionId) where.connectionId = connectionId;
  if (direction) where.direction = direction;

  const [rows, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: { transactionDate: "desc" },
      take: limit ?? 100,
      skip: offset ?? 0,
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return ok(res, { rows, total });
}
