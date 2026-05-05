// ============================================================
// Zyrix FinSuite - Marketplace Reconciliation Service
// Track C - Sprint 2 Feature 4
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  fetchMarketplaceOrders,
  fetchMarketplaceSettlements,
  MarketplaceOrderRecord,
  MarketplaceSettlementRecord,
} from "./marketplaceService";
import { ProviderKey } from "./marketplaceCatalog";

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

export async function syncMarketplaceConnection(
  connectionId: string
): Promise<SyncResult> {
  const conn = await prisma.marketplaceConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) {
    return emptyResult("Connection not found");
  }

  const merchantId = conn.merchantId;
  const provider = conn.provider as ProviderKey;

  let orders: MarketplaceOrderRecord[] = [];
  let settlements: MarketplaceSettlementRecord[] = [];

  try {
    [orders, settlements] = await Promise.all([
      fetchMarketplaceOrders({
        provider,
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
      fetchMarketplaceSettlements({
        provider,
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    await prisma.marketplaceConnection.update({
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
      await prisma.marketplaceOrder.create({
        data: {
          merchantId,
          connectionId,
          provider: provider as any,
          externalOrderId: o.externalOrderId,
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
  for (const s of settlements) {
    try {
      await prisma.marketplaceSettlement.create({
        data: {
          merchantId,
          connectionId,
          provider: provider as any,
          externalSettlementId: s.externalSettlementId,
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
      settlementsInserted++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        settlementsDuplicates++;
      }
    }
  }

  // Reconciliation pass
  let reconciledCount = 0;

  const unmatchedSettlements = await prisma.marketplaceSettlement.findMany({
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

    const tolerance = Number(s.netPayout) * 0.01;
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
      },
      orderBy: { transactionDate: "asc" },
      take: 5,
    });

    if (candidates.length === 0) continue;

    let best = candidates[0];
    let bestDist = Math.abs(+new Date(best.transactionDate) - +expectedDate);
    for (const c of candidates.slice(1)) {
      const d = Math.abs(+new Date(c.transactionDate) - +expectedDate);
      if (d < bestDist) { best = c; bestDist = d; }
    }

    const discrepancy = Math.round((Number(best.amount) - target) * 100) / 100;

    await prisma.marketplaceSettlement.update({
      where: { id: s.id },
      data: {
        matchedTxnId: best.id,
        actualPayoutDate: best.transactionDate,
        discrepancy: new Prisma.Decimal(discrepancy),
        status: Math.abs(discrepancy) < 0.5 ? "RECONCILED" : "DISCREPANCY",
      } as any,
    });
    reconciledCount++;
  }

  await prisma.marketplaceConnection.update({
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
    ordersFetched: 0, ordersInserted: 0, ordersDuplicates: 0,
    settlementsFetched: 0, settlementsInserted: 0, settlementsDuplicates: 0,
    reconciledCount: 0,
    error,
  };
}
