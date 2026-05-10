// ================================================================
// Sprint D-8 — Chat tool implementations.
//
// CRITICAL SECURITY INVARIANT: every tool takes (args, merchantId)
// from the trusted JWT context. NEVER accepts a merchantId from
// the model or the client. Every Prisma query MUST filter by
// the trusted merchantId. This is the multi-tenant isolation
// boundary spec'd in the Phase B carry-over.
//
// Tools are pure functions — no streaming, no SSE writes. The
// engine awaits each result, marshals it into a tool_result
// message, and feeds it back to Gemini.
//
// Read-only tools call into KPI_COMPUTATIONS as a public read API
// (the file is PROTECTED but its export is a documented public
// surface — D-1 contract). Mutating tools (create_reminder)
// return a PROPOSAL only; actual side effects happen in the
// allowlisted /api/customer/chat/actions endpoints (B.6).
// ================================================================
import { prisma } from "../../config/database";
import { KPI_COMPUTATIONS } from "../customer/kpiComputations";
import { READ_TOOL_NAMES, MUTATING_TOOLS } from "./tools";

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  // @ts-ignore — Prisma Decimal duck-type
  if (typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ─── Read-only tools ────────────────────────────────────────

async function get_kpi_value(args: any, merchantId: string) {
  const kpiId = String(args?.kpiId || "").trim();
  const fn = KPI_COMPUTATIONS[kpiId];
  if (!fn) {
    return { error: `unknown_kpi_id`, hint: `Valid kpiIds: ${Object.keys(KPI_COMPUTATIONS).join(", ")}` };
  }
  try {
    const result = await fn(merchantId, prisma as any);
    return {
      kpiId,
      value:     result.value,
      trendPct:  result.trend,
      sparkline: result.sparkline
    };
  } catch (err: any) {
    return { error: "kpi_compute_failed", message: err?.message || String(err) };
  }
}

async function get_top_customers(args: any, merchantId: string) {
  const limit = clampInt(args?.limit, 1, 20, 5);
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const grouped = await prisma.invoice.groupBy({
      by:      ["customerName"],
      _sum:    { total: true },
      where:   { merchantId, status: "PAID", paidDate: { gte: monthStart } },
      orderBy: { _sum: { total: "desc" } },
      take:    limit
    });
    return {
      period: "this_month",
      customers: (grouped as any[]).map((g) => ({
        name:    g.customerName || "—",
        revenue: num(g._sum?.total)
      }))
    };
  } catch (err: any) {
    return { error: "query_failed", message: err?.message || String(err) };
  }
}

async function get_invoices(args: any, merchantId: string) {
  const where: any = { merchantId };
  if (args?.status && typeof args.status === "string") {
    where.status = args.status.toUpperCase();
  }
  if (args?.customerName && typeof args.customerName === "string") {
    where.customerName = { contains: args.customerName, mode: "insensitive" };
  }
  const dateFrom = parseDate(args?.dateFrom);
  const dateTo   = parseDate(args?.dateTo);
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo)   where.createdAt.lt  = dateTo;
  }
  try {
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    20,
      select: {
        id: true, invoiceNumber: true, customerName: true,
        total: true, status: true, dueDate: true, paidDate: true, createdAt: true
      }
    });
    return {
      count: rows.length,
      invoices: rows.map((r) => ({
        id:            r.id,
        invoiceNumber: r.invoiceNumber,
        customerName:  r.customerName,
        total:         num(r.total),
        status:        r.status,
        dueDate:       r.dueDate?.toISOString() ?? null,
        paidDate:      r.paidDate?.toISOString() ?? null,
        createdAt:     r.createdAt.toISOString()
      }))
    };
  } catch (err: any) {
    return { error: "query_failed", message: err?.message || String(err) };
  }
}

async function get_expenses(args: any, merchantId: string) {
  const where: any = { merchantId };
  if (args?.category && typeof args.category === "string") {
    where.category = { contains: args.category, mode: "insensitive" };
  }
  const dateFrom = parseDate(args?.dateFrom);
  const dateTo   = parseDate(args?.dateTo);
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = dateFrom;
    if (dateTo)   where.date.lt  = dateTo;
  }
  try {
    const rows = await prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      take:    20,
      select: { id: true, category: true, amount: true, date: true, description: true }
    });
    return {
      count: rows.length,
      expenses: rows.map((r) => ({
        id:          r.id,
        category:    r.category || "—",
        amount:      num(r.amount),
        date:        r.date.toISOString(),
        description: r.description || ""
      }))
    };
  } catch (err: any) {
    return { error: "query_failed", message: err?.message || String(err) };
  }
}

async function get_tax_obligations(args: any, merchantId: string) {
  const daysAhead = clampInt(args?.daysAhead, 1, 365, 30);
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const rows = await prisma.taxEvent.findMany({
      where: {
        merchantId,
        isSubmitted: false,
        dueDate: { gte: now, lte: horizon }
      },
      orderBy: { dueDate: "asc" },
      take:    20,
      select:  { id: true, title: true, amount: true, dueDate: true }
    });
    return {
      windowDays: daysAhead,
      count:      rows.length,
      obligations: rows.map((r) => ({
        id:      r.id,
        title:   r.title,
        amount:  num(r.amount),
        dueDate: r.dueDate.toISOString()
      }))
    };
  } catch (err: any) {
    return { error: "query_failed", message: err?.message || String(err) };
  }
}

async function forecast_cash(args: any, merchantId: string) {
  const daysAhead = clampInt(args?.daysAhead, 1, 180, 30);
  try {
    // Cash on hand = sum(IN) - sum(OUT) over all bank transactions.
    const [inAgg, outAgg] = await Promise.all([
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "IN" }
      }),
      prisma.bankTransaction.aggregate({
        _sum: { amount: true },
        where: { merchantId, direction: "OUT" }
      })
    ]);
    const cash = num(inAgg._sum.amount) - num(outAgg._sum.amount);

    // Daily burn = avg expense over the last 30 days.
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const burnAgg = await prisma.expense.aggregate({
      _sum: { amount: true },
      where: { merchantId, date: { gte: monthAgo } }
    });
    const dailyBurn = num(burnAgg._sum.amount) / 30;
    const projectedBalance = cash - dailyBurn * daysAhead;

    return {
      currentCash:      cash,
      dailyBurnEstimate: dailyBurn,
      daysAhead,
      projectedBalance
    };
  } catch (err: any) {
    return { error: "forecast_failed", message: err?.message || String(err) };
  }
}

async function get_recent_insights(args: any, merchantId: string) {
  const limit = clampInt(args?.limit, 1, 10, 5);
  try {
    const rows = await prisma.insight.findMany({
      where:   { merchantId, status: { not: "ARCHIVED" } },
      orderBy: { generatedAt: "desc" },
      take:    limit,
      select:  { id: true, type: true, category: true, title: true, body: true, generatedAt: true }
    });
    return {
      count: rows.length,
      insights: rows.map((r) => ({
        id:          r.id,
        type:        String(r.type),
        category:    r.category,
        title:       r.title,
        body:        r.body,
        generatedAt: r.generatedAt.toISOString()
      }))
    };
  } catch (err: any) {
    return { error: "query_failed", message: err?.message || String(err) };
  }
}

async function compare_periods(_args: any, _merchantId: string) {
  // V1 stub per decision §7.C — Gemini should fall back to two
  // get_kpi_value calls if this returns a sentinel.
  return {
    notImplemented: true,
    hint: "Use two get_kpi_value calls instead. V2 will support arbitrary period comparisons."
  };
}

// ─── Mutating tool: PROPOSAL ONLY (no DB write here) ─────────

async function create_reminder_proposal(args: any, _merchantId: string) {
  // The model's call to this tool returns a structured proposal;
  // the engine packages it into the assistant message's `actions`
  // array. The user must click an action button to actually create
  // the reminder via POST /api/customer/chat/actions/create_reminder.
  return {
    proposal: {
      type:    "create_reminder",
      payload: {
        title:   String(args?.title   || "").slice(0, 120),
        dueDate: String(args?.dueDate || "").slice(0, 32),
        notes:   String(args?.notes   || "").slice(0, 280)
      }
    }
  };
}

// ─── Public dispatch ────────────────────────────────────────

const TOOL_IMPLS: Record<string, (args: any, merchantId: string) => Promise<any>> = {
  get_kpi_value,
  get_top_customers,
  get_invoices,
  get_expenses,
  get_tax_obligations,
  forecast_cash,
  get_recent_insights,
  compare_periods,
  create_reminder: create_reminder_proposal
};

export interface ToolDispatchResult {
  name:   string;
  result: any;
  /** True when this tool is mutating — engine emits an `action`
   *  event for the UI rather than treating result as a fact. */
  isProposal: boolean;
  /** Wall-clock ms taken by the tool execution. */
  latencyMs: number;
}

/**
 * Execute a tool by name with merchant-trusted args. Always
 * returns a result object — even errors are wrapped so Gemini
 * can see and respond to them rather than silently dropping.
 */
export async function dispatchTool(args: {
  name:       string;
  args:       any;
  merchantId: string;
}): Promise<ToolDispatchResult> {
  const t0 = Date.now();
  const impl = TOOL_IMPLS[args.name];
  const isProposal = MUTATING_TOOLS.has(args.name);
  if (!impl) {
    return {
      name:   args.name,
      result: { error: "unknown_tool", available: Object.keys(TOOL_IMPLS) },
      isProposal,
      latencyMs: Date.now() - t0
    };
  }
  try {
    const result = await impl(args.args || {}, args.merchantId);
    return { name: args.name, result, isProposal, latencyMs: Date.now() - t0 };
  } catch (err: any) {
    return {
      name:   args.name,
      result: { error: "tool_threw", message: err?.message || String(err) },
      isProposal,
      latencyMs: Date.now() - t0
    };
  }
}

/** Re-exported for the engine. */
export { READ_TOOL_NAMES, MUTATING_TOOLS };
