// ================================================================
// Sprint D-10 — Admin AI usage dashboard endpoints.
//
//   GET /api/admin/ai-usage/summary?from&to
//        Overall counts + token totals + cost forecast.
//
//   GET /api/admin/ai-usage/daily?from&to&merchantId?
//        Daily roll-up: { day, merchantId, messages, inputTokens,
//        outputTokens, totalTokens, costUsd, avgLatencyMs }.
//        Defaults to last 14 days.
//
//   GET /api/admin/ai-usage/top-merchants?from&to&limit?
//        Ranked by total tokens. Default limit 20.
//
//   GET /api/admin/ai-usage/latency?from&to
//        P50 / P95 / max latency across the window.
//
// Reads ChatMessage columns shipped in D-8 (tokensUsed, inputTokens,
// outputTokens, latencyMs) joined to ChatConversation for merchantId.
// No schema changes; protected files (kpiComputations.ts etc.) are
// untouched per the carry-over hard rule.
//
// All endpoints require admin JWT (mounted under authenticateAdmin
// in routes/admin/index.ts).
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// Gemini 2.0 Flash pricing (as of 2026-05): $0.075 per 1M input,
// $0.30 per 1M output. Forecast is best-effort — actual billing comes
// from Google Cloud Console.
const COST_PER_INPUT_TOKEN_USD  = 0.075 / 1_000_000;
const COST_PER_OUTPUT_TOKEN_USD = 0.30  / 1_000_000;

const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS     = 90;

interface DateWindow { from: Date; to: Date; }

function parseWindow(req: Request): DateWindow {
  const now = new Date();
  let to   = req.query.to   ? new Date(String(req.query.to))   : now;
  let from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86400000);

  if (Number.isNaN(to.getTime()))   to   = now;
  if (Number.isNaN(from.getTime())) from = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86400000);

  // Clamp to MAX_WINDOW_DAYS so admins can't accidentally aggregate years of data.
  const minFrom = new Date(to.getTime() - MAX_WINDOW_DAYS * 86400000);
  if (from < minFrom) from = minFrom;
  if (from >= to) from = new Date(to.getTime() - 86400000);

  return { from, to };
}

function costFor(inputTokens: number, outputTokens: number): number {
  return inputTokens * COST_PER_INPUT_TOKEN_USD + outputTokens * COST_PER_OUTPUT_TOKEN_USD;
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const adminAiUsageController = {

  // GET /api/admin/ai-usage/summary
  summary: h(async (req: Request, res: Response): Promise<void> => {
    const { from, to } = parseWindow(req);

    // Single Prisma aggregate over the window.
    const agg = await prisma.chatMessage.aggregate({
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum:   { tokensUsed: true, inputTokens: true, outputTokens: true },
      _avg:   { latencyMs:   true }
    });

    const distinctMerchants = await prisma.chatConversation.findMany({
      where:  { messages: { some: { createdAt: { gte: from, lt: to } } } },
      select: { merchantId: true },
      distinct: ["merchantId"]
    });

    const inputTokens  = intOrNull(agg._sum.inputTokens)  || 0;
    const outputTokens = intOrNull(agg._sum.outputTokens) || 0;
    const totalTokens  = intOrNull(agg._sum.tokensUsed)   || 0;

    res.json({
      success: true,
      data: {
        from:           from.toISOString(),
        to:             to.toISOString(),
        windowDays:     Math.round((to.getTime() - from.getTime()) / 86400000),
        messages:       agg._count._all || 0,
        merchants:      distinctMerchants.length,
        inputTokens,
        outputTokens,
        totalTokens,
        avgLatencyMs:   intOrNull(agg._avg.latencyMs),
        costUsdForecast: Number(costFor(inputTokens, outputTokens).toFixed(4))
      }
    });
  }),

  // GET /api/admin/ai-usage/daily
  daily: h(async (req: Request, res: Response): Promise<void> => {
    const { from, to } = parseWindow(req);
    const merchantFilter = req.query.merchantId ? String(req.query.merchantId) : undefined;

    // Pull all messages in window + conversation merchantId, then
    // aggregate in JS (Prisma's groupBy doesn't compose with relation
    // joins for date_trunc cleanly across SQLite/Postgres). Volume at
    // 2-merchant scale is tiny; promote to a SQL view if message
    // volume crosses ~1M/day.
    const rows = await prisma.chatMessage.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(merchantFilter ? { conversation: { merchantId: merchantFilter } } : {})
      },
      select: {
        createdAt:    true,
        tokensUsed:   true,
        inputTokens:  true,
        outputTokens: true,
        latencyMs:    true,
        conversation: { select: { merchantId: true } }
      },
      take: 50_000   // hard ceiling so a misconfigured 'from' can't OOM the box
    });

    type Bucket = {
      day: string;
      merchantId: string;
      messages: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      latencySum: number;
      latencyCount: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const r of rows) {
      const dayKey = r.createdAt.toISOString().slice(0, 10);
      const merchantId = r.conversation?.merchantId || "unknown";
      const key = `${dayKey}|${merchantId}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          day:           dayKey,
          merchantId,
          messages:      0,
          inputTokens:   0,
          outputTokens:  0,
          totalTokens:   0,
          latencySum:    0,
          latencyCount:  0
        };
        buckets.set(key, b);
      }
      b.messages++;
      b.inputTokens  += intOrNull(r.inputTokens)  || 0;
      b.outputTokens += intOrNull(r.outputTokens) || 0;
      b.totalTokens  += intOrNull(r.tokensUsed)   || 0;
      const lat = intOrNull(r.latencyMs);
      if (lat !== null) { b.latencySum += lat; b.latencyCount++; }
    }

    const data = Array.from(buckets.values())
      .map((b) => ({
        day:           b.day,
        merchantId:    b.merchantId,
        messages:      b.messages,
        inputTokens:   b.inputTokens,
        outputTokens:  b.outputTokens,
        totalTokens:   b.totalTokens,
        avgLatencyMs:  b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : null,
        costUsd:       Number(costFor(b.inputTokens, b.outputTokens).toFixed(4))
      }))
      .sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : a.merchantId.localeCompare(b.merchantId));

    res.json({
      success: true,
      data: { from: from.toISOString(), to: to.toISOString(), rows: data, truncated: rows.length === 50_000 }
    });
  }),

  // GET /api/admin/ai-usage/top-merchants
  topMerchants: h(async (req: Request, res: Response): Promise<void> => {
    const { from, to } = parseWindow(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);

    const rows = await prisma.chatMessage.findMany({
      where:  { createdAt: { gte: from, lt: to } },
      select: {
        tokensUsed: true,
        inputTokens: true,
        outputTokens: true,
        conversation: { select: { merchantId: true } }
      },
      take: 50_000
    });

    const totals = new Map<string, { merchantId: string; messages: number; totalTokens: number; inputTokens: number; outputTokens: number }>();
    for (const r of rows) {
      const merchantId = r.conversation?.merchantId || "unknown";
      let t = totals.get(merchantId);
      if (!t) { t = { merchantId, messages: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 }; totals.set(merchantId, t); }
      t.messages++;
      t.totalTokens  += intOrNull(r.tokensUsed)   || 0;
      t.inputTokens  += intOrNull(r.inputTokens)  || 0;
      t.outputTokens += intOrNull(r.outputTokens) || 0;
    }

    // Hydrate merchant names for the leaderboard so the admin page
    // doesn't need a second round-trip per row.
    const merchantIds = Array.from(totals.keys()).filter((id) => id !== "unknown");
    const merchants = merchantIds.length > 0
      ? await prisma.merchant.findMany({
          where:  { id: { in: merchantIds } },
          select: { id: true, name: true, businessName: true, email: true }
        })
      : [];
    const nameMap = new Map(merchants.map((m) => [m.id, m]));

    const data = Array.from(totals.values())
      .map((t) => {
        const m = nameMap.get(t.merchantId);
        return {
          merchantId:    t.merchantId,
          merchantName:  m ? (m.businessName || m.name) : null,
          email:         m?.email || null,
          messages:      t.messages,
          totalTokens:   t.totalTokens,
          inputTokens:   t.inputTokens,
          outputTokens:  t.outputTokens,
          costUsd:       Number(costFor(t.inputTokens, t.outputTokens).toFixed(4))
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, limit);

    res.json({
      success: true,
      data: { from: from.toISOString(), to: to.toISOString(), rows: data }
    });
  }),

  // GET /api/admin/ai-usage/latency
  latency: h(async (req: Request, res: Response): Promise<void> => {
    const { from, to } = parseWindow(req);

    const rows = await prisma.chatMessage.findMany({
      where:  { createdAt: { gte: from, lt: to }, latencyMs: { not: null } },
      select: { latencyMs: true },
      take:   50_000
    });
    const latencies = rows
      .map((r) => intOrNull(r.latencyMs))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);

    function pct(p: number): number | null {
      if (latencies.length === 0) return null;
      const idx = Math.min(latencies.length - 1, Math.floor(latencies.length * p));
      return latencies[idx];
    }

    res.json({
      success: true,
      data: {
        from:    from.toISOString(),
        to:      to.toISOString(),
        samples: latencies.length,
        p50:     pct(0.5),
        p90:     pct(0.9),
        p95:     pct(0.95),
        p99:     pct(0.99),
        max:     latencies.length > 0 ? latencies[latencies.length - 1] : null
      }
    });
  })
};
