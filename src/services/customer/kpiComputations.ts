// ================================================================
// Phase 16 — Real KPI computations for the customer Pano.
// One function per KPI, each ((merchantId, prisma) -> KpiResult).
// All queries are read-only and wrapped in try/catch so a single
// failure returns EMPTY for that id without crashing the response.
//
// Schema mapping (vs the Prompt 5 spec placeholders):
//   Invoice.totalAmount    -> Invoice.total
//   Invoice.paidAt         -> Invoice.paidDate
//   Invoice.customerId     -> NOT PRESENT (groupBy customerName instead)
//   Customer.status        -> NOT PRESENT (no filter applied)
//   Expense.incurredAt     -> Expense.date
//   PurchaseInvoice        -> NOT PRESENT (Expense used as COGS proxy)
//   CashAccount.balance    -> derived from BankTransaction direction IN/OUT
//   TaxObligation          -> TaxEvent (isSubmitted boolean, not status)
// ================================================================
import { PrismaClient } from "@prisma/client";

export interface KpiResult {
  value: number | null;
  trend: number;
  sparkline: number[];
}

const EMPTY: KpiResult = { value: null, trend: 0, sparkline: new Array(14).fill(0) };

const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfMonth = (offsetMonths = 0): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const trendPct = (current: number, prior: number): number => {
  if (!prior || prior === 0) return current > 0 ? 100 : 0;
  return ((current - prior) / prior) * 100;
};

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  // Prisma Decimal has toNumber(); also handles strings
  // @ts-ignore — runtime duck-typing
  if (typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function fillSparkline(rows: Array<{ day: Date | string; total: number | string }>, daysBack: number): number[] {
  const result = new Array(daysBack).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const row of rows) {
    const rowDate = new Date(row.day);
    rowDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24));
    const idx = daysBack - 1 - diffDays;
    if (idx >= 0 && idx < daysBack) {
      result[idx] = num(row.total);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// MRR — paid sales invoices this month
// ─────────────────────────────────────────────────────────────
export async function computeMrr(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const monthStart = startOfMonth(0);
    const lastMonthStart = startOfMonth(-1);
    const lastMonthEnd = startOfMonth(0);

    const [thisMonthAgg, lastMonthAgg, dailyRows] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      }),
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: lastMonthStart, lt: lastMonthEnd } },
      }),
      prisma.$queryRawUnsafe<Array<{ day: Date; total: number }>>(
        `SELECT DATE_TRUNC('day', "paidDate")::date AS day,
                COALESCE(SUM("total"), 0)::float AS total
         FROM "invoices"
         WHERE "merchantId" = $1 AND "status" = 'PAID' AND "paidDate" >= $2
         GROUP BY 1 ORDER BY 1 ASC`,
        merchantId,
        daysAgo(13)
      ),
    ]);

    const value = num(thisMonthAgg._sum.total);
    const prior = num(lastMonthAgg._sum.total);
    return { value, trend: trendPct(value, prior), sparkline: fillSparkline(dailyRows, 14) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Cash balance — sum(IN) − sum(OUT) of bank transactions
// ─────────────────────────────────────────────────────────────
async function computeCashBalanceRaw(merchantId: string, prisma: PrismaClient): Promise<number> {
  const [inAgg, outAgg] = await Promise.all([
    prisma.bankTransaction.aggregate({
      _sum: { amount: true },
      where: { merchantId, direction: "IN" },
    }),
    prisma.bankTransaction.aggregate({
      _sum: { amount: true },
      where: { merchantId, direction: "OUT" },
    }),
  ]);
  return num(inAgg._sum.amount) - num(outAgg._sum.amount);
}

export async function computeCashBalance(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const value = await computeCashBalanceRaw(merchantId, prisma);
    return { value, trend: 0, sparkline: new Array(14).fill(value) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Cash runway in days — cash / daily burn (last 30 days)
// ─────────────────────────────────────────────────────────────
export async function computeCashRunway(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const cash = await computeCashBalanceRaw(merchantId, prisma);

    const [burn30Agg, burnPriorAgg] = await Promise.all([
      prisma.expense.aggregate({
        _sum: { amount: true },
        where: { merchantId, date: { gte: daysAgo(30) } },
      }),
      prisma.expense.aggregate({
        _sum: { amount: true },
        where: { merchantId, date: { gte: daysAgo(60), lt: daysAgo(30) } },
      }),
    ]);

    const dailyBurn = num(burn30Agg._sum.amount) / 30;
    const dailyBurnPrior = num(burnPriorAgg._sum.amount) / 30;
    const runway = dailyBurn > 0 ? Math.floor(cash / dailyBurn) : 365;
    const runwayPrior = dailyBurnPrior > 0 ? cash / dailyBurnPrior : 365;

    return {
      value: runway,
      trend: trendPct(runway, runwayPrior),
      sparkline: new Array(14).fill(runway),
    };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Customer health % — share of customers with healthScore ≥ 70
// ─────────────────────────────────────────────────────────────
export async function computeCustomerHealthPct(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const total = await prisma.customer.count({ where: { merchantId } });
    if (total === 0) return { value: 0, trend: 0, sparkline: new Array(14).fill(0) };

    const healthy = await prisma.customer.count({
      where: { merchantId, healthScore: { gte: 70 } },
    });
    const pct = (healthy / total) * 100;
    return { value: pct, trend: 0, sparkline: new Array(14).fill(pct) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Tax burden — unpaid TaxEvents due in next 30 days
// ─────────────────────────────────────────────────────────────
export async function computeTaxBurden(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const now = new Date();
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);

    const agg = await prisma.taxEvent.aggregate({
      _sum: { amount: true },
      where: {
        merchantId,
        isSubmitted: false,
        dueDate: { gte: now, lte: in30 },
      },
    });
    const value = num(agg._sum.amount);
    return { value, trend: 0, sparkline: new Array(14).fill(value) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Overdue receivables — unpaid invoices past due date
// ─────────────────────────────────────────────────────────────
export async function computeOverdueReceivables(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const today = new Date();
    const agg = await prisma.invoice.aggregate({
      _sum: { total: true },
      where: { merchantId, status: { in: ["SENT", "OVERDUE"] }, dueDate: { lt: today } },
    });
    const value = num(agg._sum.total);
    return { value, trend: 0, sparkline: new Array(14).fill(value) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Pending invoices — DRAFT or SENT count
// ─────────────────────────────────────────────────────────────
export async function computePendingInvoices(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const count = await prisma.invoice.count({
      where: { merchantId, status: { in: ["DRAFT", "SENT"] } },
    });
    return { value: count, trend: 0, sparkline: new Array(14).fill(count) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Gross margin % — (revenue − expenses) / revenue this month.
// Uses Expense as COGS proxy (no PurchaseInvoice in schema).
// ─────────────────────────────────────────────────────────────
export async function computeGrossMargin(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const monthStart = startOfMonth(0);
    const [revenueAgg, costAgg] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      }),
      prisma.expense.aggregate({
        _sum: { amount: true },
        where: { merchantId, date: { gte: monthStart } },
      }),
    ]);
    const rev = num(revenueAgg._sum.total);
    const cost = num(costAgg._sum.amount);
    if (rev === 0) return EMPTY;
    const margin = ((rev - cost) / rev) * 100;
    return { value: margin, trend: 0, sparkline: new Array(14).fill(margin) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Top customer revenue — biggest single customer this month.
// Schema lacks Invoice.customerId FK; group by customerName string.
// ─────────────────────────────────────────────────────────────
export async function computeTopCustomerRevenue(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const monthStart = startOfMonth(0);
    const grouped = await prisma.invoice.groupBy({
      by: ["customerName"],
      _sum: { total: true },
      where: { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      orderBy: { _sum: { total: "desc" } },
      take: 1,
    });
    const value = grouped.length > 0 ? num(grouped[0]._sum.total) : 0;
    return { value, trend: 0, sparkline: new Array(14).fill(value) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// MRR growth % — current vs prior month
// ─────────────────────────────────────────────────────────────
export async function computeMrrGrowthPct(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const monthStart = startOfMonth(0);
    const lastMonthStart = startOfMonth(-1);
    const lastMonthEnd = startOfMonth(0);
    const [a, b] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      }),
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: lastMonthStart, lt: lastMonthEnd } },
      }),
    ]);
    const cur = num(a._sum.total);
    const pri = num(b._sum.total);
    const pct = trendPct(cur, pri);
    return { value: pct, trend: 0, sparkline: new Array(14).fill(pct) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// New customers in last 30 days
// ─────────────────────────────────────────────────────────────
export async function computeNewCustomers30d(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const [count, priorCount] = await Promise.all([
      prisma.customer.count({ where: { merchantId, createdAt: { gte: daysAgo(30) } } }),
      prisma.customer.count({
        where: { merchantId, createdAt: { gte: daysAgo(60), lt: daysAgo(30) } },
      }),
    ]);
    return { value: count, trend: trendPct(count, priorCount), sparkline: new Array(14).fill(count) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// ARPU — revenue this month / total customer count
// (no Customer.status to filter on)
// ─────────────────────────────────────────────────────────────
export async function computeArpu(merchantId: string, prisma: PrismaClient): Promise<KpiResult> {
  try {
    const monthStart = startOfMonth(0);
    const [count, revenueAgg] = await Promise.all([
      prisma.customer.count({ where: { merchantId } }),
      prisma.invoice.aggregate({
        _sum: { total: true },
        where: { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      }),
    ]);
    if (count === 0) return EMPTY;
    const arpu = num(revenueAgg._sum.total) / count;
    return { value: arpu, trend: 0, sparkline: new Array(14).fill(arpu) };
  } catch {
    return EMPTY;
  }
}

// ─────────────────────────────────────────────────────────────
// Registry — id → computation. Aspirational KPIs return EMPTY.
// ─────────────────────────────────────────────────────────────
export const KPI_COMPUTATIONS: Record<string, (m: string, p: PrismaClient) => Promise<KpiResult>> = {
  mrr: computeMrr,
  mrr_growth_pct: computeMrrGrowthPct,
  top_customer_revenue: computeTopCustomerRevenue,
  arpu: computeArpu,
  gross_margin: computeGrossMargin,
  new_customers_30d: computeNewCustomers30d,
  cash_balance: computeCashBalance,
  cash_runway: computeCashRunway,
  overdue_receivables: computeOverdueReceivables,
  pending_invoices: computePendingInvoices,
  customer_health_pct: computeCustomerHealthPct,
  tax_burden: computeTaxBurden,

  // No PurchaseInvoice / Expense.dueDate in schema → cannot compute.
  payable_30d: async () => EMPTY,

  // Aspirational — features not yet shipped or no underlying data.
  churn_rate: async () => EMPTY,
  nrr: async () => EMPTY,
  ai_actions_taken_today: async () => EMPTY,
  predictions_accuracy_30d: async () => EMPTY,
  automation_savings_hours: async () => EMPTY,
  crisis_risk_score: async () => EMPTY,
  hidden_cash_found_30d: async () => EMPTY,
  inventory_turnover: async () => EMPTY,
  service_utilization: async () => EMPTY,
  kdv_load: async () => EMPTY,
  vat_load: async () => EMPTY,
  zatca_compliance: async () => EMPTY,
};
