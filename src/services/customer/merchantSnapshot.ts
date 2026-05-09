// ================================================================
// Phase 16 — Merchant snapshot for AI Co-Pilot grounding.
// Builds a structured packet of the merchant's actual KPI values by
// calling the same KPI_COMPUTATIONS registry the dashboard endpoint
// uses. Guarantees the AI's view of the world == the user's view.
// ================================================================
import { PrismaClient } from "@prisma/client";
import { KPI_COMPUTATIONS } from "./kpiComputations";

export interface MerchantSnapshot {
  generatedAt: string;
  currency: string;
  language: string;
  focus: string;
  kpis: {
    mrr:                  number | null;
    mrr_growth_pct:       number | null;
    cash_balance:         number | null;
    cash_runway_days:     number | null;
    overdue_receivables:  number | null;
    payable_30d:          number | null;
    pending_invoices:     number | null;
    new_customers_30d:    number | null;
    customer_health_pct:  number | null;
    top_customer_revenue: number | null;
    tax_burden:           number | null;
  };
  context: {
    has_data: boolean;
    invoice_count_30d: number;
    customer_count: number;
  };
}

const SNAPSHOT_KPIS = [
  "mrr", "mrr_growth_pct", "cash_balance", "cash_runway",
  "overdue_receivables", "payable_30d", "pending_invoices",
  "new_customers_30d", "customer_health_pct", "top_customer_revenue",
  "tax_burden"
];

export async function buildMerchantSnapshot(
  merchantId: string,
  prisma: PrismaClient,
  language = "tr",
  focus = "all",
  currency = "TRY"
): Promise<MerchantSnapshot> {
  // Run all snapshot KPIs in parallel; per-KPI try/catch is already
  // baked into each computation function from Prompt 5.
  const entries = await Promise.all(
    SNAPSHOT_KPIS.map(async (id) => {
      const fn = KPI_COMPUTATIONS[id];
      if (!fn) return [id, null] as const;
      try {
        const r = await fn(merchantId, prisma);
        return [id, r.value] as const;
      } catch {
        return [id, null] as const;
      }
    })
  );

  const k = Object.fromEntries(entries) as Record<string, number | null>;

  // Light context — used by Gemini to soften the tone for empty merchants.
  let invoice_count_30d = 0;
  let customer_count = 0;
  try {
    invoice_count_30d = await prisma.invoice.count({
      where: {
        merchantId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }
    });
  } catch { /* leave 0 */ }
  try {
    customer_count = await prisma.customer.count({ where: { merchantId } });
  } catch { /* leave 0 */ }

  return {
    generatedAt: new Date().toISOString(),
    currency,
    language,
    focus,
    kpis: {
      mrr:                  k.mrr,
      mrr_growth_pct:       k.mrr_growth_pct,
      cash_balance:         k.cash_balance,
      cash_runway_days:     k.cash_runway,
      overdue_receivables:  k.overdue_receivables,
      payable_30d:          k.payable_30d,
      pending_invoices:     k.pending_invoices,
      new_customers_30d:    k.new_customers_30d,
      customer_health_pct:  k.customer_health_pct,
      top_customer_revenue: k.top_customer_revenue,
      tax_burden:           k.tax_burden
    },
    context: {
      has_data: invoice_count_30d > 0 || customer_count > 0,
      invoice_count_30d,
      customer_count
    }
  };
}
