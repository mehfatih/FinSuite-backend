// ============================================================
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
