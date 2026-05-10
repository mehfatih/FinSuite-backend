// ================================================================
// Sprint D-6 — Customer-side weekly report API.
//
//   GET    /api/customer/weekly-report                  — list (paginated)
//   GET    /api/customer/weekly-report/:id               — single row
//   GET    /api/customer/weekly-report/:id/pdf          — on-demand PDF buffer
//   POST   /api/customer/weekly-report/regenerate        — force regenerate THIS week's row (no send)
//   POST   /api/customer/weekly-report/test              — fire a one-off send to merchant
//   GET    /api/customer/weekly-report/subscription      — get subscription row + tz
//   PATCH  /api/customer/weekly-report/subscription      — update subscription
//   GET    /api/customer/weekly-report/stats              — last-30-day engagement
//
// All authenticated; merchantId comes from req.merchant.id.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { generateWeeklyReport } from "../../services/weeklyReport/generator";
import { renderReportPdf } from "../../services/weeklyReport/renderReportPdf";
import { sendWeeklyReport } from "../../services/weeklyReport/sendWeeklyReport";
import { computeWeekBounds } from "../../services/weeklyReport/scheduler";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const TEST_RATELIMIT_MS = 60_000;
const REGEN_RATELIMIT_MS = 60_000;
const lastTestAt  = new Map<string, number>();
const lastRegenAt = new Map<string, number>();

const SUBSCRIPTION_DEFAULTS = {
  enabled:       true,
  sendDayLocal:  0,
  sendHourLocal: 18,
  pausedUntil:   null as Date | null,
  bounceCount:   0
};

function subscriptionPayload(row: any | null) {
  if (!row) return { ...SUBSCRIPTION_DEFAULTS, persisted: false };
  return {
    enabled:       row.enabled,
    sendDayLocal:  row.sendDayLocal,
    sendHourLocal: row.sendHourLocal,
    pausedUntil:   row.pausedUntil,
    bounceCount:   row.bounceCount,
    lastSentAt:    row.lastSentAt,
    persisted:     true
  };
}

export const weeklyReportController = {

  // ── GET /api/customer/weekly-report ─────────────────────────
  list: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit ?? "12"), 10) || 12));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const [rows, total] = await Promise.all([
        prisma.weeklyReport.findMany({
          where:   { merchantId },
          orderBy: { weekStart: "desc" },
          take:    limit,
          skip:    offset,
          select:  {
            id: true, weekStart: true, weekEnd: true,
            language: true, status: true, generatedAt: true,
            kpiSnapshot: true
          }
        }),
        prisma.weeklyReport.count({ where: { merchantId } })
      ]);
      // Trim kpiSnapshot to a small "headline" preview for the archive grid.
      const reports = rows.map((r) => {
        const k = ((r.kpiSnapshot as any)?.kpis) || {};
        return {
          id:         r.id,
          weekStart:  r.weekStart,
          weekEnd:    r.weekEnd,
          language:   r.language,
          status:     r.status,
          generatedAt: r.generatedAt,
          headline: {
            mrr:     k.mrr?.value     ?? null,
            netCash: k.netCash?.value ?? null,
            margin:  k.margin?.value  ?? null,
            runway:  k.runway?.value  ?? null
          }
        };
      });
      res.json({ success: true, data: { reports, total, limit, offset } });
    } catch (err: any) {
      console.error("[customer/weeklyReport.list] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load reports" });
    }
  }),

  // ── GET /api/customer/weekly-report/:id ─────────────────────
  getById: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    if (!id) { res.status(400).json({ success: false, error: "id_required" }); return; }
    try {
      const row = await prisma.weeklyReport.findFirst({
        where:  { id, merchantId },
        select: {
          id: true, weekStart: true, weekEnd: true, narrative: true,
          insightIds: true, kpiSnapshot: true, language: true,
          status: true, generatedAt: true
        }
      });
      if (!row) { res.status(404).json({ success: false, error: "report_not_found" }); return; }
      res.json({ success: true, data: { report: row } });
    } catch (err: any) {
      console.error("[customer/weeklyReport.getById] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load report" });
    }
  }),

  // ── GET /api/customer/weekly-report/:id/pdf ─────────────────
  // On-demand re-render per decision §6.B option B1.
  getPdf: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    if (!id) { res.status(400).json({ success: false, error: "id_required" }); return; }
    try {
      // Authorize against ownership before rendering (PDF is expensive).
      const row = await prisma.weeklyReport.findFirst({
        where:  { id, merchantId },
        select: { id: true }
      });
      if (!row) { res.status(404).json({ success: false, error: "report_not_found" }); return; }
      const pdf = await renderReportPdf({ reportId: id });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(pdf.buffer);
    } catch (err: any) {
      console.error("[customer/weeklyReport.getPdf] error:", err?.message || err);
      res.status(500).json({ success: false, error: "PDF render failed" });
    }
  }),

  // ── POST /api/customer/weekly-report/regenerate ─────────────
  // Force-regenerate THIS week's row (re-runs Gemini narrative).
  // No email send — for that use /test.
  regenerate: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const last = lastRegenAt.get(merchantId) || 0;
    if (Date.now() - last < REGEN_RATELIMIT_MS) {
      const wait = Math.ceil((REGEN_RATELIMIT_MS - (Date.now() - last)) / 1000);
      res.status(429).json({ success: false, error: "rate_limited", waitSeconds: wait });
      return;
    }
    lastRegenAt.set(merchantId, Date.now());

    try {
      const merchant = await prisma.merchant.findUnique({
        where:  { id: merchantId },
        select: { timezone: true, language: true }
      });
      if (!merchant) { res.status(404).json({ success: false, error: "merchant_not_found" }); return; }

      const { weekStart, weekEnd } = computeWeekBounds(merchant.timezone || "Europe/Istanbul");
      const language = (merchant.language as any || "TR").toString().toLowerCase() as "tr" | "en" | "ar";

      const out = await generateWeeklyReport({
        merchantId, weekStart, weekEnd, language, force: true
      });
      res.json({ success: true, data: { reportId: out.reportId, reused: out.reused } });
    } catch (err: any) {
      console.error("[customer/weeklyReport.regenerate] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Regenerate failed" });
    }
  }),

  // ── POST /api/customer/weekly-report/test ───────────────────
  // Send the current week's report to the merchant immediately.
  test: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const last = lastTestAt.get(merchantId) || 0;
    if (Date.now() - last < TEST_RATELIMIT_MS) {
      const wait = Math.ceil((TEST_RATELIMIT_MS - (Date.now() - last)) / 1000);
      res.status(429).json({ success: false, error: "rate_limited", waitSeconds: wait });
      return;
    }
    lastTestAt.set(merchantId, Date.now());

    try {
      const merchant = await prisma.merchant.findUnique({
        where:  { id: merchantId },
        select: { timezone: true, language: true }
      });
      if (!merchant) { res.status(404).json({ success: false, error: "merchant_not_found" }); return; }

      const { weekStart, weekEnd } = computeWeekBounds(merchant.timezone || "Europe/Istanbul");
      const language = (merchant.language as any || "TR").toString().toLowerCase() as "tr" | "en" | "ar";

      const result = await sendWeeklyReport({ merchantId, weekStart, weekEnd, language });
      if (!result.ok) {
        res.status(502).json({ success: false, error: result.reason || "send_failed" });
        return;
      }
      res.json({ success: true, data: { reportId: result.reportId, sendId: result.sendId } });
    } catch (err: any) {
      console.error("[customer/weeklyReport.test] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Test send failed" });
    }
  }),

  // ── GET /api/customer/weekly-report/subscription ────────────
  getSubscription: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const [row, merchant] = await Promise.all([
        prisma.weeklyReportSubscription.findUnique({ where: { merchantId } }),
        prisma.merchant.findUnique({ where: { id: merchantId }, select: { timezone: true } })
      ]);
      res.json({
        success: true,
        data: {
          subscription: subscriptionPayload(row),
          timezone:     merchant?.timezone || "Europe/Istanbul"
        }
      });
    } catch (err: any) {
      console.error("[customer/weeklyReport.getSubscription] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load subscription" });
    }
  }),

  // ── PATCH /api/customer/weekly-report/subscription ──────────
  updateSubscription: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const body = req.body || {};
    const patch: any = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.sendDayLocal === "number" && body.sendDayLocal >= 0 && body.sendDayLocal <= 6) {
      patch.sendDayLocal = Math.floor(body.sendDayLocal);
    }
    if (typeof body.sendHourLocal === "number" && body.sendHourLocal >= 0 && body.sendHourLocal <= 23) {
      patch.sendHourLocal = Math.floor(body.sendHourLocal);
    }
    if (body.clearPause === true) patch.pausedUntil = null;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: "no_valid_fields" }); return;
    }

    try {
      const row = await prisma.weeklyReportSubscription.upsert({
        where:  { merchantId },
        update: patch,
        create: { merchantId, ...SUBSCRIPTION_DEFAULTS, ...patch }
      });
      res.json({ success: true, data: { subscription: subscriptionPayload(row) } });
    } catch (err: any) {
      console.error("[customer/weeklyReport.updateSubscription] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update subscription" });
    }
  }),

  // ── GET /api/customer/weekly-report/stats ───────────────────
  stats: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.weeklyReportSend.findMany({
        where:  { merchantId, sentAt: { gte: since } },
        select: { deliveredAt: true, openedAt: true, clickedAt: true, status: true }
      });
      const sent      = rows.length;
      const delivered = rows.filter((r) => r.deliveredAt).length;
      const opened    = rows.filter((r) => r.openedAt).length;
      const clicked   = rows.filter((r) => r.clickedAt).length;
      const bounced   = rows.filter((r) => r.status === "failed").length;
      res.json({
        success: true,
        data: {
          windowDays: 30,
          sent, delivered, opened, clicked, bounced,
          openRate:  sent ? Math.round((opened / sent)  * 100) : 0,
          clickRate: sent ? Math.round((clicked / sent) * 100) : 0
        }
      });
    } catch (err: any) {
      console.error("[customer/weeklyReport.stats] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load stats" });
    }
  })
};
