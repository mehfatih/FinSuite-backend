// ================================================================
// Sprint D-6 — Arbitrary-window KPI helpers for the weekly report.
//
// Decision §6.A: kpiComputations.ts is protected and computes only
// for fixed calendar windows (current month, last 30 days). The
// weekly report needs WoW deltas over arbitrary 7-day windows, so
// we read the same Prisma tables here without modifying the
// protected file.
//
// Public API:
//   buildWeeklySnapshot({ merchantId, prisma, weekStart, weekEnd })
//     → WeeklySnapshot — feeds the PDF template + email + narrative.
//
// All queries are read-only and individually try/caught so a single
// failure returns a zero-valued field instead of crashing the row.
// ================================================================
import { PrismaClient } from "@prisma/client";

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  // @ts-ignore — Prisma Decimal duck-type
  if (typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const trendPct = (current: number, prior: number): number => {
  if (!prior || prior === 0) return current > 0 ? 100 : 0;
  return ((current - prior) / prior) * 100;
};

const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, days: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
};

export interface KpiCell {
  value:    number;
  delta:    number;     // absolute (current - prior)
  deltaPct: number;     // percent change
}

export interface DailyAmount {
  date:    string;      // YYYY-MM-DD
  amount:  number;
}

export interface WeeklySnapshot {
  weekStart: string;    // YYYY-MM-DD (inclusive)
  weekEnd:   string;    // YYYY-MM-DD (inclusive — Sunday of the week)
  currency:  string;
  merchantNew: boolean;  // <7 days since signup → "Foundation Week" variant

  kpis: {
    mrr:     KpiCell;
    netCash: KpiCell;
    margin:  KpiCell;     // gross margin %
    runway:  KpiCell;     // days
  };

  revenue: {
    total:        number;
    avgDaily:     number;
    bestDay:      DailyAmount | null;
    worstDay:     DailyAmount | null;
    dailySeries:  DailyAmount[];   // 7 entries (current week)
    priorSeries:  DailyAmount[];   // 7 entries (prior week)
    topCustomers: Array<{ name: string; amount: number }>;
  };

  cash: {
    inflowTotal:  number;
    outflowTotal: number;
    netFlow:      number;
    topExpenses:  Array<{ category: string; amount: number; date: string }>;
  };

  customers: {
    totalCount:        number;
    concentration:     Array<{ name: string; amount: number; pct: number }>;
    topCustomerShare:  number;
  };

  tax: {
    upcoming: Array<{ title: string; amount: number; dueDate: string }>;
  };
}

// ─── Internal: 4-KPI snapshot with WoW deltas ──────────────────

async function mrrForWindow(prisma: PrismaClient, merchantId: string, start: Date, end: Date): Promise<number> {
  try {
    const agg = await prisma.invoice.aggregate({
      _sum: { total: true },
      where: { merchantId, status: "PAID", paidDate: { gte: start, lt: end } }
    });
    return num(agg._sum.total);
  } catch { return 0; }
}

async function expensesForWindow(prisma: PrismaClient, merchantId: string, start: Date, end: Date): Promise<number> {
  try {
    const agg = await prisma.expense.aggregate({
      _sum: { amount: true },
      where: { merchantId, date: { gte: start, lt: end } }
    });
    return num(agg._sum.amount);
  } catch { return 0; }
}

async function cashUpTo(prisma: PrismaClient, merchantId: string, asOf: Date): Promise<number> {
  try {
    const [inAgg, outAgg] = await Promise.all([
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "IN",  transactionDate: { lt: asOf } }
      }),
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "OUT", transactionDate: { lt: asOf } }
      })
    ]);
    return num(inAgg._sum.amount) - num(outAgg._sum.amount);
  } catch { return 0; }
}

async function inOutForWindow(
  prisma: PrismaClient, merchantId: string, start: Date, end: Date
): Promise<{ inflow: number; outflow: number }> {
  try {
    const [inAgg, outAgg] = await Promise.all([
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "IN",  transactionDate: { gte: start, lt: end } }
      }),
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "OUT", transactionDate: { gte: start, lt: end } }
      })
    ]);
    return { inflow: num(inAgg._sum.amount), outflow: num(outAgg._sum.amount) };
  } catch { return { inflow: 0, outflow: 0 }; }
}

async function dailyRevenueRows(
  prisma: PrismaClient, merchantId: string, start: Date, end: Date
): Promise<Array<{ day: Date; total: number }>> {
  try {
    return await prisma.$queryRawUnsafe<Array<{ day: Date; total: number }>>(
      `SELECT DATE_TRUNC('day', "paidDate")::date AS day,
              COALESCE(SUM("total"), 0)::float    AS total
         FROM "invoices"
        WHERE "merchantId" = $1
          AND "status"     = 'PAID'
          AND "paidDate"   >= $2
          AND "paidDate"   <  $3
        GROUP BY 1 ORDER BY 1 ASC`,
      merchantId, start, end
    );
  } catch { return []; }
}

function fillSeries(rows: Array<{ day: Date; total: number }>, start: Date, days = 7): DailyAmount[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(isoDate(new Date(r.day)), num(r.total));
  }
  const out: DailyAmount[] = [];
  for (let i = 0; i < days; i++) {
    const d  = addDays(start, i);
    const k  = isoDate(d);
    out.push({ date: k, amount: map.get(k) || 0 });
  }
  return out;
}

// ─── Public entry point ────────────────────────────────────────

export async function buildWeeklySnapshot(args: {
  merchantId: string;
  prisma:     PrismaClient;
  weekStart:  Date;          // inclusive (Monday 00:00 local)
  weekEnd:    Date;          // exclusive (next Monday 00:00 local) — caller owns the math
  currency?:  string;
  merchantCreatedAt?: Date | null;
}): Promise<WeeklySnapshot> {
  const { merchantId, prisma, weekStart, weekEnd } = args;
  const currency = args.currency || "TRY";
  const priorStart = addDays(weekStart, -7);
  const priorEnd   = weekStart;

  const merchantNew = !!(args.merchantCreatedAt && (Date.now() - args.merchantCreatedAt.getTime()) < 7 * 24 * 60 * 60 * 1000);

  // Run independent queries in parallel.
  const [
    mrrCur, mrrPri,
    expCur, expPri,
    cashEnd, cashPriorEnd,
    flowsCur,
    dailyRows, priorDailyRows,
    topCustomers, topExpenses,
    customerCount, customerAggMonth,
    upcomingTax
  ] = await Promise.all([
    mrrForWindow(prisma, merchantId, weekStart, weekEnd),
    mrrForWindow(prisma, merchantId, priorStart, priorEnd),
    expensesForWindow(prisma, merchantId, weekStart, weekEnd),
    expensesForWindow(prisma, merchantId, priorStart, priorEnd),
    cashUpTo(prisma, merchantId, weekEnd),
    cashUpTo(prisma, merchantId, weekStart),
    inOutForWindow(prisma, merchantId, weekStart, weekEnd),
    dailyRevenueRows(prisma, merchantId, weekStart, weekEnd),
    dailyRevenueRows(prisma, merchantId, priorStart, priorEnd),
    prisma.invoice.groupBy({
      by: ["customerName"],
      _sum: { total: true },
      where: { merchantId, status: "PAID", paidDate: { gte: weekStart, lt: weekEnd } },
      orderBy: { _sum: { total: "desc" } },
      take: 5
    }).catch(() => []),
    prisma.expense.findMany({
      where: { merchantId, date: { gte: weekStart, lt: weekEnd } },
      orderBy: { amount: "desc" },
      take: 5,
      select: { category: true, amount: true, date: true }
    }).catch(() => []),
    prisma.customer.count({ where: { merchantId } }).catch(() => 0),
    prisma.invoice.groupBy({
      by: ["customerName"],
      _sum: { total: true },
      where: { merchantId, status: "PAID", paidDate: { gte: addDays(weekEnd, -30), lt: weekEnd } },
      orderBy: { _sum: { total: "desc" } },
      take: 5
    }).catch(() => []),
    prisma.taxEvent.findMany({
      where: { merchantId, isSubmitted: false, dueDate: { gte: weekStart, lt: addDays(weekEnd, 7) } },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { title: true, amount: true, dueDate: true }
    }).catch(() => [])
  ]);

  // ── KPI cells ──
  const mrr     = { value: mrrCur, delta: mrrCur - mrrPri, deltaPct: trendPct(mrrCur, mrrPri) };
  const netCash = { value: cashEnd, delta: cashEnd - cashPriorEnd, deltaPct: trendPct(cashEnd, cashPriorEnd) };

  const marginCur = mrrCur > 0 ? ((mrrCur - expCur) / mrrCur) * 100 : 0;
  const marginPri = mrrPri > 0 ? ((mrrPri - expPri) / mrrPri) * 100 : 0;
  const margin    = { value: marginCur, delta: marginCur - marginPri, deltaPct: trendPct(marginCur, marginPri) };

  const dailyBurnCur = expCur / 7;
  const dailyBurnPri = expPri / 7;
  const runwayCur = dailyBurnCur > 0 ? Math.floor(cashEnd / dailyBurnCur)       : 365;
  const runwayPri = dailyBurnPri > 0 ? Math.floor(cashPriorEnd / dailyBurnPri)  : 365;
  const runway    = { value: runwayCur, delta: runwayCur - runwayPri, deltaPct: trendPct(runwayCur, runwayPri) };

  // ── Revenue ──
  const dailySeries  = fillSeries(dailyRows,      weekStart);
  const priorSeries  = fillSeries(priorDailyRows, priorStart);
  const totalRevenue = dailySeries.reduce((s, r) => s + r.amount, 0);
  const sortedDays   = [...dailySeries].sort((a, b) => b.amount - a.amount);
  const bestDay  = sortedDays.length > 0 && sortedDays[0].amount > 0 ? sortedDays[0]                     : null;
  const worstDay = sortedDays.length > 0                              ? sortedDays[sortedDays.length - 1] : null;

  // ── Customer concentration (last 30 days) ──
  const totalRev30 = (customerAggMonth as any[]).reduce<number>((s, r) => s + num(r?._sum?.total), 0);
  const concentration = (customerAggMonth as any[]).map((r) => ({
    name:   r.customerName || "—",
    amount: num(r._sum.total),
    pct:    totalRev30 > 0 ? (num(r._sum.total) / totalRev30) * 100 : 0
  }));
  const topCustomerShare = concentration.length > 0 ? concentration[0].pct : 0;

  return {
    weekStart: isoDate(weekStart),
    weekEnd:   isoDate(addDays(weekEnd, -1)),  // display as inclusive Sunday
    currency,
    merchantNew,
    kpis: { mrr, netCash, margin, runway },
    revenue: {
      total:        totalRevenue,
      avgDaily:     totalRevenue / 7,
      bestDay,
      worstDay,
      dailySeries,
      priorSeries,
      topCustomers: (topCustomers as any[]).map((c) => ({
        name:   c.customerName || "—",
        amount: num(c?._sum?.total)
      }))
    },
    cash: {
      inflowTotal:  flowsCur.inflow,
      outflowTotal: flowsCur.outflow,
      netFlow:      flowsCur.inflow - flowsCur.outflow,
      topExpenses:  topExpenses.map((e) => ({
        category: e.category || "—",
        amount:   num(e.amount),
        date:     isoDate(new Date(e.date))
      }))
    },
    customers: {
      totalCount:       customerCount,
      concentration,
      topCustomerShare
    },
    tax: {
      upcoming: upcomingTax.map((t) => ({
        title:   t.title,
        amount:  num(t.amount),
        dueDate: isoDate(new Date(t.dueDate))
      }))
    }
  };
}
