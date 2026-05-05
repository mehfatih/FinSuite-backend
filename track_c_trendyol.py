# ============================================================
# Trendyol Auto-Reconciliation - Combined backend batch
# ============================================================
from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("Trendyol Reconciliation - Backend batch")
print("=" * 70)

# ============================================================
# 1) Update prisma/schema.prisma
# ============================================================
SCHEMA = ROOT / "prisma" / "schema.prisma"
shutil.copy2(SCHEMA, SCHEMA.with_suffix(".prisma.backup-trendyol"))
print()
print("[1/8] Update schema.prisma")

text = SCHEMA.read_text(encoding="utf-8")

# Add new enums after CashCrisisStatus
old_enum_anchor = """enum CashCrisisStatus {
  ACTIVE
  DISMISSED
  RESOLVED
  EXPIRED
}"""

new_enum_anchor = """enum CashCrisisStatus {
  ACTIVE
  DISMISSED
  RESOLVED
  EXPIRED
}

enum TrendyolOrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
  RETURNED
}

enum TrendyolSettlementStatus {
  PENDING
  PAID
  RECONCILED
  DISCREPANCY
}

enum TrendyolConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  ERROR
}"""

if "enum TrendyolOrderStatus" not in text:
    if old_enum_anchor in text:
        text = text.replace(old_enum_anchor, new_enum_anchor, 1)
        print("    [OK] Added 3 enums")
    else:
        print("    [FAIL] CashCrisisStatus anchor not found")
        raise SystemExit(1)

# Add 3 models AFTER CashCrisisAlert
m = re.search(
    r'(model CashCrisisAlert \{[^}]*?@@map\("cash_crisis_alerts"\)\n\})',
    text, flags=re.DOTALL,
)
if not m:
    print("    [FAIL] CashCrisisAlert model not found")
    raise SystemExit(1)

cc_block = m.group(1)
new_models = '''

model TrendyolConnection {
  id            String                    @id @default(uuid())
  merchantId    String                    @unique
  sellerId      String?
  apiKey        String?
  apiSecret     String?
  storeName     String?
  status        TrendyolConnectionStatus  @default(PENDING)
  lastSyncAt    DateTime?
  lastSyncError String?
  createdAt     DateTime                  @default(now())
  updatedAt     DateTime                  @updatedAt
  merchant      Merchant                  @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  orders        TrendyolOrder[]
  settlements   TrendyolSettlement[]

  @@index([status])
  @@map("trendyol_connections")
}

model TrendyolOrder {
  id              String              @id @default(uuid())
  merchantId      String
  connectionId    String
  trendyolOrderId String
  orderNumber     String
  status          TrendyolOrderStatus
  customerName    String?
  productName     String?
  quantity        Int                 @default(1)
  grossAmount     Decimal             @db.Decimal(18, 2)
  commission      Decimal             @default(0) @db.Decimal(18, 2)
  shippingCost    Decimal             @default(0) @db.Decimal(18, 2)
  netAmount       Decimal             @db.Decimal(18, 2)
  currency        String              @default("TRY")
  orderDate       DateTime
  shippedDate     DateTime?
  deliveredDate   DateTime?
  matchedTxnId    String?
  providerData    Json?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  merchant        Merchant            @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  connection      TrendyolConnection  @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, trendyolOrderId])
  @@index([merchantId])
  @@index([status])
  @@index([orderDate(sort: Desc)])
  @@index([matchedTxnId])
  @@map("trendyol_orders")
}

model TrendyolSettlement {
  id                    String                   @id @default(uuid())
  merchantId            String
  connectionId          String
  trendyolSettlementId  String
  periodStart           DateTime
  periodEnd             DateTime
  grossSales            Decimal                  @default(0) @db.Decimal(18, 2)
  totalCommission       Decimal                  @default(0) @db.Decimal(18, 2)
  totalShipping         Decimal                  @default(0) @db.Decimal(18, 2)
  totalReturns          Decimal                  @default(0) @db.Decimal(18, 2)
  netPayout             Decimal                  @db.Decimal(18, 2)
  currency              String                   @default("TRY")
  status                TrendyolSettlementStatus @default(PENDING)
  expectedPayoutDate    DateTime?
  actualPayoutDate      DateTime?
  matchedTxnId          String?
  discrepancy           Decimal?                 @db.Decimal(18, 2)
  orderCount            Int                      @default(0)
  providerData          Json?
  createdAt             DateTime                 @default(now())
  updatedAt             DateTime                 @updatedAt
  merchant              Merchant                 @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  connection            TrendyolConnection       @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, trendyolSettlementId])
  @@index([merchantId])
  @@index([status])
  @@index([periodStart(sort: Desc)])
  @@map("trendyol_settlements")
}'''

if "model TrendyolConnection" not in text:
    text = text.replace(cc_block, cc_block + new_models, 1)
    print("    [OK] Added TrendyolConnection + TrendyolOrder + TrendyolSettlement models")

# Add Merchant relations
old_rels = '''  cashCrisisAlerts  CashCrisisAlert[]
  muhasebeciLinks   MuhasebeciLink[]'''

new_rels = '''  cashCrisisAlerts  CashCrisisAlert[]
  trendyolConnection  TrendyolConnection?
  trendyolOrders      TrendyolOrder[]
  trendyolSettlements TrendyolSettlement[]
  muhasebeciLinks   MuhasebeciLink[]'''

if "trendyolConnection" not in text:
    text = text.replace(old_rels, new_rels, 1)
    print("    [OK] Added 3 Merchant relations")

SCHEMA.write_text(text, encoding="utf-8")

# ============================================================
# 2) Create src/services/trendyolService.ts
# ============================================================
SVC1 = ROOT / "src" / "services" / "trendyolService.ts"
print()
print("[2/8] Create trendyolService.ts (sandbox client)")

svc1_content = '''// ============================================================
// Zyrix FinSuite - Trendyol API Client (Sandbox)
// Track C - Sprint 2 Feature 3
//
// In sandbox mode, returns synthetic but realistic Trendyol
// orders + settlements. Real Trendyol Marketplace API will
// replace these stubs once credentials are configured.
// ============================================================

import { env } from "../config/env";

export type TrendyolOrderRecord = {
  trendyolOrderId: string;
  orderNumber: string;
  status: "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED";
  customerName: string;
  productName: string;
  quantity: number;
  grossAmount: number;
  commission: number;
  shippingCost: number;
  netAmount: number;
  currency: string;
  orderDate: Date;
  shippedDate?: Date;
  deliveredDate?: Date;
};

export type TrendyolSettlementRecord = {
  trendyolSettlementId: string;
  periodStart: Date;
  periodEnd: Date;
  grossSales: number;
  totalCommission: number;
  totalShipping: number;
  totalReturns: number;
  netPayout: number;
  currency: string;
  expectedPayoutDate: Date;
  orderCount: number;
};

const SAMPLE_PRODUCTS = [
  "Krem Sampuan 500ml",
  "Vitamin C Serum 30ml",
  "LaserPro Beyazlatma Kremi",
  "Yuz Maskesi 5'li",
  "Goz Kremi Anti-Age",
  "Vitamin E Yag",
  "Sac Bakim Yagi 100ml",
  "Cilt Tonik 200ml",
];

const SAMPLE_NAMES = [
  "Ayse Y.", "Mehmet T.", "Fatma O.", "Ahmet K.", "Zeynep A.",
  "Mustafa D.", "Elif G.", "Hasan B.", "Sevgi M.", "Yusuf C.",
];

function pseudoRandom(seed: string, idx: number): number {
  let h = 0;
  const s = seed + ":" + idx;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) / 2147483647;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

export async function fetchTrendyolOrders(args: {
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<TrendyolOrderRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxOrders(args.sellerId || "TR-SELLER", 30);
  }
  // TODO: real Trendyol Marketplace API integration
  return [];
}

export async function fetchTrendyolSettlements(args: {
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<TrendyolSettlementRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxSettlements(args.sellerId || "TR-SELLER");
  }
  return [];
}

// ----------------------------------------------------------------
// Sandbox generators
// ----------------------------------------------------------------

function generateSandboxOrders(seed: string, count: number): TrendyolOrderRecord[] {
  const orders: TrendyolOrderRecord[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const r = pseudoRandom(seed, i);
    const r2 = pseudoRandom(seed, i + 1000);

    const productIdx = Math.floor(r * SAMPLE_PRODUCTS.length);
    const customerIdx = Math.floor(r2 * SAMPLE_NAMES.length);

    const quantity = 1 + Math.floor(r * 3);
    const unitPrice = Math.round((50 + r * 450) * 100) / 100;
    const grossAmount = quantity * unitPrice;
    const commissionRate = 0.18 + r * 0.05; // 18-23%
    const commission = Math.round(grossAmount * commissionRate * 100) / 100;
    const shippingCost = Math.round((15 + r * 25) * 100) / 100;
    const netAmount = Math.round((grossAmount - commission - shippingCost) * 100) / 100;

    const daysAgo = Math.floor(r2 * 60);
    const orderDate = new Date(now - daysAgo * 86400000);

    let status: TrendyolOrderRecord["status"] = "DELIVERED";
    if (daysAgo < 1) status = "PENDING";
    else if (daysAgo < 3) status = "CONFIRMED";
    else if (daysAgo < 5) status = "SHIPPED";
    else if (r < 0.05) status = "RETURNED";
    else if (r < 0.07) status = "CANCELLED";

    orders.push({
      trendyolOrderId: "TY-" + seed + "-" + (now - daysAgo * 86400000).toString(36),
      orderNumber: "TY" + String(1000000 + i).slice(0, 7),
      status,
      customerName: SAMPLE_NAMES[customerIdx],
      productName: SAMPLE_PRODUCTS[productIdx],
      quantity,
      grossAmount,
      commission,
      shippingCost,
      netAmount,
      currency: "TRY",
      orderDate,
      shippedDate: status !== "PENDING" && status !== "CONFIRMED"
        ? new Date(orderDate.getTime() + 2 * 86400000)
        : undefined,
      deliveredDate: status === "DELIVERED"
        ? new Date(orderDate.getTime() + 4 * 86400000)
        : undefined,
    });
  }

  return orders;
}

function generateSandboxSettlements(seed: string): TrendyolSettlementRecord[] {
  const settlements: TrendyolSettlementRecord[] = [];
  const now = Date.now();

  // Generate 4 weekly settlements over last 28 days
  for (let i = 0; i < 4; i++) {
    const r = pseudoRandom(seed, i + 5000);
    const periodEnd = new Date(now - i * 7 * 86400000);
    const periodStart = new Date(periodEnd.getTime() - 7 * 86400000);

    const orderCount = 8 + Math.floor(r * 25);
    const grossSales = Math.round((orderCount * (200 + r * 600)) * 100) / 100;
    const totalCommission = Math.round(grossSales * 0.20 * 100) / 100;
    const totalShipping = Math.round(orderCount * 25 * 100) / 100;
    const totalReturns = Math.round(grossSales * 0.05 * r * 100) / 100;
    const netPayout = Math.round((grossSales - totalCommission - totalShipping - totalReturns) * 100) / 100;

    settlements.push({
      trendyolSettlementId: "TYS-" + seed + "-" + periodEnd.getTime().toString(36),
      periodStart,
      periodEnd,
      grossSales,
      totalCommission,
      totalShipping,
      totalReturns,
      netPayout,
      currency: "TRY",
      expectedPayoutDate: new Date(periodEnd.getTime() + 3 * 86400000),
      orderCount,
    });
  }

  return settlements;
}
'''

SVC1.write_text(svc1_content, encoding="utf-8")
print("    [OK] Created (size: " + str(SVC1.stat().st_size) + " bytes)")

# ============================================================
# 3) Create src/services/trendyolReconciliationService.ts
# ============================================================
SVC2 = ROOT / "src" / "services" / "trendyolReconciliationService.ts"
print()
print("[3/8] Create trendyolReconciliationService.ts")

svc2_content = '''// ============================================================
// Zyrix FinSuite - Trendyol Reconciliation Service
// Track C - Sprint 2 Feature 3
//
// Matches Trendyol settlements against incoming bank
// transactions. The matching heuristic:
// - Bank txn direction = IN
// - Amount within 1% of settlement netPayout (or exact)
// - Date within +/- 5 days of expectedPayoutDate
// - Optional: counterparty name contains "trendyol" / "ty"
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  fetchTrendyolOrders,
  fetchTrendyolSettlements,
  TrendyolOrderRecord,
  TrendyolSettlementRecord,
} from "./trendyolService";

export type SyncResult = {
  success: boolean;
  ordersFetched: number;
  ordersInserted: number;
  ordersDuplicates: number;
  settlementsFetched: number;
  settlementsInserted: number;
  settlementsDuplicates: number;
  reconciledCount: number;
  error?: string;
};

export async function syncTrendyolConnection(
  connectionId: string
): Promise<SyncResult> {
  const conn = await prisma.trendyolConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) {
    return emptyResult("Connection not found");
  }

  const merchantId = conn.merchantId;

  let orders: TrendyolOrderRecord[] = [];
  let settlements: TrendyolSettlementRecord[] = [];

  try {
    [orders, settlements] = await Promise.all([
      fetchTrendyolOrders({
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
      fetchTrendyolSettlements({
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    await prisma.trendyolConnection.update({
      where: { id: connectionId },
      data: { lastSyncError: msg, status: "ERROR" as any } as any,
    });
    return emptyResult(msg);
  }

  // Insert orders
  let ordersInserted = 0;
  let ordersDuplicates = 0;
  for (const o of orders) {
    try {
      await prisma.trendyolOrder.create({
        data: {
          merchantId,
          connectionId,
          trendyolOrderId: o.trendyolOrderId,
          orderNumber: o.orderNumber,
          status: o.status as any,
          customerName: o.customerName,
          productName: o.productName,
          quantity: o.quantity,
          grossAmount: new Prisma.Decimal(o.grossAmount),
          commission: new Prisma.Decimal(o.commission),
          shippingCost: new Prisma.Decimal(o.shippingCost),
          netAmount: new Prisma.Decimal(o.netAmount),
          currency: o.currency,
          orderDate: o.orderDate,
          shippedDate: o.shippedDate || null,
          deliveredDate: o.deliveredDate || null,
          providerData: o as any,
        } as any,
      });
      ordersInserted++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        ordersDuplicates++;
      }
    }
  }

  // Insert settlements
  let settlementsInserted = 0;
  let settlementsDuplicates = 0;
  const newSettlements: any[] = [];
  for (const s of settlements) {
    try {
      const created = await prisma.trendyolSettlement.create({
        data: {
          merchantId,
          connectionId,
          trendyolSettlementId: s.trendyolSettlementId,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          grossSales: new Prisma.Decimal(s.grossSales),
          totalCommission: new Prisma.Decimal(s.totalCommission),
          totalShipping: new Prisma.Decimal(s.totalShipping),
          totalReturns: new Prisma.Decimal(s.totalReturns),
          netPayout: new Prisma.Decimal(s.netPayout),
          currency: s.currency,
          expectedPayoutDate: s.expectedPayoutDate,
          orderCount: s.orderCount,
          providerData: s as any,
          status: "PENDING" as any,
        } as any,
      });
      newSettlements.push(created);
      settlementsInserted++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        settlementsDuplicates++;
      }
    }
  }

  // Reconciliation pass: try to match unmatched settlements
  // with bank transactions
  let reconciledCount = 0;

  const unmatchedSettlements = await prisma.trendyolSettlement.findMany({
    where: {
      merchantId,
      connectionId,
      status: { in: ["PENDING", "PAID"] as any },
      matchedTxnId: null,
    },
    take: 50,
  });

  for (const s of unmatchedSettlements) {
    const expectedDate = s.expectedPayoutDate;
    if (!expectedDate) continue;

    const lo = new Date(expectedDate.getTime() - 5 * 86400000);
    const hi = new Date(expectedDate.getTime() + 5 * 86400000);

    const tolerance = Number(s.netPayout) * 0.01; // 1%
    const target = Number(s.netPayout);

    const candidates = await prisma.bankTransaction.findMany({
      where: {
        merchantId,
        direction: "IN" as any,
        transactionDate: { gte: lo, lte: hi },
        amount: {
          gte: new Prisma.Decimal(target - tolerance - 1),
          lte: new Prisma.Decimal(target + tolerance + 1),
        },
        // not already matched to another settlement
      },
      orderBy: {
        transactionDate: "asc",
      },
      take: 5,
    });

    if (candidates.length === 0) continue;

    // Pick the closest to expected date
    let best = candidates[0];
    let bestDist = Math.abs(+new Date(best.transactionDate) - +expectedDate);
    for (const c of candidates.slice(1)) {
      const d = Math.abs(+new Date(c.transactionDate) - +expectedDate);
      if (d < bestDist) { best = c; bestDist = d; }
    }

    const discrepancy = Math.round((Number(best.amount) - target) * 100) / 100;

    await prisma.trendyolSettlement.update({
      where: { id: s.id },
      data: {
        matchedTxnId: best.id,
        actualPayoutDate: best.transactionDate,
        discrepancy: new Prisma.Decimal(discrepancy),
        status: Math.abs(discrepancy) < 0.5
          ? "RECONCILED"
          : "DISCREPANCY",
      } as any,
    });
    reconciledCount++;
  }

  await prisma.trendyolConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: null,
      status: "CONNECTED" as any,
    } as any,
  });

  return {
    success: true,
    ordersFetched: orders.length,
    ordersInserted,
    ordersDuplicates,
    settlementsFetched: settlements.length,
    settlementsInserted,
    settlementsDuplicates,
    reconciledCount,
  };
}

function emptyResult(error?: string): SyncResult {
  return {
    success: false,
    ordersFetched: 0,
    ordersInserted: 0,
    ordersDuplicates: 0,
    settlementsFetched: 0,
    settlementsInserted: 0,
    settlementsDuplicates: 0,
    reconciledCount: 0,
    error,
  };
}
'''

SVC2.write_text(svc2_content, encoding="utf-8")
print("    [OK] Created (size: " + str(SVC2.stat().st_size) + " bytes)")

# ============================================================
# 4) Create src/controllers/trendyolController.ts
# ============================================================
CTRL = ROOT / "src" / "controllers" / "trendyolController.ts"
print()
print("[4/8] Create trendyolController.ts")

ctrl_content = '''// ============================================================
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
'''

CTRL.write_text(ctrl_content, encoding="utf-8")
print("    [OK] Created (size: " + str(CTRL.stat().st_size) + " bytes)")

# ============================================================
# 5) Create src/routes/trendyol.ts
# ============================================================
RT = ROOT / "src" / "routes" / "trendyol.ts"
print()
print("[5/8] Create trendyol.ts route")

rt_content = '''// ============================================================
// Zyrix FinSuite - Trendyol Routes
// Track C - Sprint 2 Feature 3
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  connectHandler,
  connectionHandler,
  syncHandler,
  ordersHandler,
  settlementsHandler,
  disconnectHandler,
} from "../controllers/trendyolController";

const router = Router();
router.use(authenticate as any);

const syncRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Sync can be run at most 12 times per hour.",
  },
});

router.post("/connect",        connectHandler as any);
router.get("/connection",      connectionHandler as any);
router.post("/sync",           syncRateLimiter, syncHandler as any);
router.get("/orders",          ordersHandler as any);
router.get("/settlements",     settlementsHandler as any);
router.delete("/connection",   disconnectHandler as any);

export default router;
'''

RT.write_text(rt_content, encoding="utf-8")
print("    [OK] Created")

# ============================================================
# 6) Wire into src/index.ts
# ============================================================
INDEX = ROOT / "src" / "index.ts"
shutil.copy2(INDEX, INDEX.with_suffix(".ts.backup-trendyol"))
print()
print("[6/8] Wire into src/index.ts")

idx = INDEX.read_text(encoding="utf-8")

new_imp = 'import trendyolRoutes      from "./routes/trendyol";'
new_use = 'app.use("/api/trendyol",       trendyolRoutes);'

if "trendyolRoutes" not in idx:
    idx = idx.replace(
        'import cashCrisisRoutes    from "./routes/cashCrisis";',
        'import cashCrisisRoutes    from "./routes/cashCrisis";\n' + new_imp,
        1,
    )
    print("    [OK] Import added")

if '"/api/trendyol"' not in idx:
    idx = idx.replace(
        'app.use("/api/cash-crisis",    cashCrisisRoutes);',
        'app.use("/api/cash-crisis",    cashCrisisRoutes);\n' + new_use,
        1,
    )
    print("    [OK] Route registered")

idx = idx.replace("Zyrix FinSuite v3.6", "Zyrix FinSuite v3.7", 1)
idx = idx.replace("22 features | 42 routes", "23 features | 48 routes", 1)
INDEX.write_text(idx, encoding="utf-8")
print("    [OK] Version v3.7")

# ============================================================
# 7-8) Verification
# ============================================================
print()
print("[7/8] Verification")
final = INDEX.read_text(encoding="utf-8")
schema_final = SCHEMA.read_text(encoding="utf-8")
checks = [
    ("schema: 3 enums",            all(e in schema_final for e in ["enum TrendyolOrderStatus", "enum TrendyolSettlementStatus", "enum TrendyolConnectionStatus"])),
    ("schema: 3 models",           all(m in schema_final for m in ["model TrendyolConnection", "model TrendyolOrder", "model TrendyolSettlement"])),
    ("schema: Merchant relations", "trendyolConnection" in schema_final and "trendyolOrders" in schema_final),
    ("trendyolService exists",     SVC1.exists()),
    ("trendyolReconciliation exists", SVC2.exists()),
    ("Controller exists",          CTRL.exists()),
    ("Route exists",               RT.exists()),
    ("/api/trendyol wired",        '"/api/trendyol"' in final),
    ("v3.7",                       "v3.7" in final),
    ("23 features | 48 routes",    "23 features | 48 routes" in final),
]
passed = 0
for label, ok_check in checks:
    s = "OK" if ok_check else "MISSING"
    if ok_check: passed += 1
    print("     " + label.ljust(35) + " -> " + s)
print()
print("RESULT: " + str(passed) + "/" + str(len(checks)) + " checks passed")
print("=" * 70)
