// ============================================================
// Zyrix FinSuite - Marketplace Sandbox Client
// Track C - Sprint 2 Feature 4
//
// Generates synthetic orders + settlements per provider using
// the catalog metadata. Real provider APIs plug in here later
// by switching on env.bankSandboxMode.
// ============================================================

import { env } from "../config/env";
import { PROVIDERS, SAMPLE_CUSTOMERS, ProviderKey } from "./marketplaceCatalog";

export type MarketplaceOrderRecord = {
  externalOrderId: string;
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

export type MarketplaceSettlementRecord = {
  externalSettlementId: string;
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

function pseudoRandom(seed: string, idx: number): number {
  let h = 0;
  const s = seed + ":" + idx;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) / 2147483647;
}

function providerOrderPrefix(provider: ProviderKey): string {
  return provider.split("_")[0].slice(0, 4).toUpperCase();
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

export async function fetchMarketplaceOrders(args: {
  provider: ProviderKey;
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<MarketplaceOrderRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxOrders(args.provider, args.sellerId || "SELLER");
  }
  // TODO: real API integration per provider
  return [];
}

export async function fetchMarketplaceSettlements(args: {
  provider: ProviderKey;
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<MarketplaceSettlementRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxSettlements(args.provider, args.sellerId || "SELLER");
  }
  return [];
}

// ----------------------------------------------------------------
// Sandbox generators
// ----------------------------------------------------------------

function generateSandboxOrders(
  provider: ProviderKey,
  seed: string
): MarketplaceOrderRecord[] {
  const cfg = PROVIDERS[provider];
  if (!cfg) return [];

  const orders: MarketplaceOrderRecord[] = [];
  const now = Date.now();
  const customers = SAMPLE_CUSTOMERS[cfg.country];
  const prefix = providerOrderPrefix(provider);

  // Generate ~4 weeks of orders
  const totalCount = cfg.weeklyOrderVolume * 4;

  for (let i = 0; i < totalCount; i++) {
    const r = pseudoRandom(seed + ":" + provider, i);
    const r2 = pseudoRandom(seed + ":" + provider, i + 1000);

    const productIdx = Math.floor(r * cfg.products.length);
    const customerIdx = Math.floor(r2 * customers.length);

    const quantity = 1 + Math.floor(r * 3);
    const variance = 0.5 + r2; // 0.5x to 1.5x of average
    const unitPrice = Math.round(cfg.averageOrderValue * variance / quantity * 100) / 100;
    const grossAmount = Math.round(quantity * unitPrice * 100) / 100;
    const commission = Math.round(grossAmount * cfg.commissionRate * 100) / 100;
    const shippingCost = Math.round((10 + r * 30) * 100) / 100;
    const netAmount = Math.round((grossAmount - commission - shippingCost) * 100) / 100;

    const daysAgo = Math.floor(r2 * 60);
    const orderDate = new Date(now - daysAgo * 86400000);

    let status: MarketplaceOrderRecord["status"] = "DELIVERED";
    if (daysAgo < 1) status = "PENDING";
    else if (daysAgo < 3) status = "CONFIRMED";
    else if (daysAgo < 5) status = "SHIPPED";
    else if (r < 0.05) status = "RETURNED";
    else if (r < 0.07) status = "CANCELLED";

    orders.push({
      externalOrderId: prefix + "-" + seed + "-" + i + "-" + (now - daysAgo * 86400000).toString(36),
      orderNumber: prefix + String(1000000 + i).slice(0, 7),
      status,
      customerName: customers[customerIdx],
      productName: cfg.products[productIdx],
      quantity,
      grossAmount,
      commission,
      shippingCost,
      netAmount,
      currency: cfg.currency,
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

function generateSandboxSettlements(
  provider: ProviderKey,
  seed: string
): MarketplaceSettlementRecord[] {
  const cfg = PROVIDERS[provider];
  if (!cfg) return [];

  const settlements: MarketplaceSettlementRecord[] = [];
  const now = Date.now();
  const prefix = providerOrderPrefix(provider);

  // Generate 4 weekly settlements over last 28 days
  for (let i = 0; i < 4; i++) {
    const r = pseudoRandom(seed + ":" + provider, i + 5000);
    const periodEnd = new Date(now - i * 7 * 86400000);
    const periodStart = new Date(periodEnd.getTime() - 7 * 86400000);

    const orderCount = cfg.weeklyOrderVolume + Math.floor(r * 5);
    const grossSales = Math.round(orderCount * cfg.averageOrderValue * 100) / 100;
    const totalCommission = Math.round(grossSales * cfg.commissionRate * 100) / 100;
    const totalShipping = Math.round(orderCount * 25 * 100) / 100;
    const totalReturns = Math.round(grossSales * 0.05 * r * 100) / 100;
    const netPayout = Math.round((grossSales - totalCommission - totalShipping - totalReturns) * 100) / 100;

    settlements.push({
      externalSettlementId: prefix + "S-" + seed + "-" + periodEnd.getTime().toString(36),
      periodStart,
      periodEnd,
      grossSales,
      totalCommission,
      totalShipping,
      totalReturns,
      netPayout,
      currency: cfg.currency,
      expectedPayoutDate: new Date(periodEnd.getTime() + 3 * 86400000),
      orderCount,
    });
  }

  return settlements;
}
