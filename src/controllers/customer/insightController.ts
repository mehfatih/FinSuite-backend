// ================================================================
// Sprint D-1 — Insight controller.
//   GET   /api/customer/insights/history?days=7
//   PATCH /api/customer/insights/:id          { status }
//
// History returns ACTIVE | DISMISSED | RESOLVED rows generated within
// the last `days` days, newest first, capped at 200.
// PATCH transitions status to DISMISSED | RESOLVED | ARCHIVED and
// stamps the corresponding *At column. ACTIVE → DISMISSED is the
// most common transition; ARCHIVED is a soft-delete.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { InsightStatus } from "@prisma/client";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const HISTORY_MAX_DAYS  = 90;
const HISTORY_MAX_LIMIT = 200;

const ALLOWED_TRANSITIONS: InsightStatus[] = [
  InsightStatus.DISMISSED,
  InsightStatus.RESOLVED,
  InsightStatus.ARCHIVED,
  InsightStatus.ACTIVE,    // allow re-opening from DISMISSED/RESOLVED
];

export const insightController = {
  // ── GET /history ───────────────────────────────────────────
  history: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      const daysRaw  = parseInt(String(req.query.days  ?? "7"), 10);
      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);
      const days  = Math.min(Math.max(Number.isFinite(daysRaw)  ? daysRaw  : 7,   1), HISTORY_MAX_DAYS);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), HISTORY_MAX_LIMIT);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await prisma.insight.findMany({
        where: {
          merchantId: userId,
          generatedAt: { gte: since },
          status: { not: InsightStatus.ARCHIVED },
        },
        orderBy: { generatedAt: "desc" },
        take: limit,
        select: {
          id: true, type: true, category: true,
          title: true, body: true,
          ctaLabel: true, ctaRoute: true,
          numericRefs: true, language: true, source: true,
          status: true,
          generatedAt: true, expiresAt: true,
          dismissedAt: true, resolvedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        data: { insights: rows, count: rows.length, days, limit },
      });
    } catch (err: any) {
      console.error("[customer/insights/history] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load insight history." });
    }
  }),

  // ── PATCH /:id ─────────────────────────────────────────────
  updateStatus: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }
      const id = String(req.params.id || "");
      const status = String(req.body?.status || "").toUpperCase() as InsightStatus;
      if (!id) {
        res.status(400).json({ success: false, error: "Missing insight id." });
        return;
      }
      if (!ALLOWED_TRANSITIONS.includes(status)) {
        res.status(400).json({ success: false, error: "Invalid status." });
        return;
      }

      const existing = await prisma.insight.findUnique({ where: { id } });
      if (!existing || existing.merchantId !== userId) {
        res.status(404).json({ success: false, error: "Insight not found." });
        return;
      }

      const now = new Date();
      const data: Parameters<typeof prisma.insight.update>[0]["data"] = { status };
      if (status === InsightStatus.DISMISSED) data.dismissedAt = now;
      if (status === InsightStatus.RESOLVED)  data.resolvedAt  = now;
      if (status === InsightStatus.ACTIVE) {
        data.dismissedAt = null;
        data.resolvedAt  = null;
      }

      const updated = await prisma.insight.update({ where: { id }, data });
      res.status(200).json({ success: true, data: { insight: updated } });
    } catch (err: any) {
      console.error("[customer/insights/updateStatus] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update insight status." });
    }
  }),
};
