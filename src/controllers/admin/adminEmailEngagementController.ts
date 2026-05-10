// ================================================================
// Sprint D-5 — Admin email-engagement dashboard controller.
//   GET   /api/admin/email-engagement                — aggregates
//   GET   /api/admin/email-engagement/bounced       — current bounced list
//   POST  /api/admin/email-engagement/:merchantId/re-enable
//                                                   — clear bounce + enable
//
// All gated by authenticateAdmin (mounted in routes/admin/index.ts).
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const WINDOW_DAYS = 30;
const TOP_SUBJECT_LIMIT = 10;
const BOUNCED_LIST_LIMIT = 100;

export const adminEmailEngagementController = {
  // GET /api/admin/email-engagement
  getStats: h(async (_req: Request, res: Response): Promise<void> => {
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

      // Pull all sends in window joined with merchant locale.
      const sends = await prisma.morningBriefSend.findMany({
        where:   { sentAt: { gte: since } },
        select:  {
          subject: true, status: true,
          deliveredAt: true, openedAt: true, clickedAt: true,
          unsubscribeClicked: true,
          merchant: { select: { language: true } }
        }
      });

      const totalSent = sends.length;
      const totalDelivered = sends.filter((s) => !!s.deliveredAt).length;
      const totalOpened    = sends.filter((s) => !!s.openedAt).length;
      const totalClicked   = sends.filter((s) => !!s.clickedAt).length;
      const totalBounced   = sends.filter((s) => s.status === "failed").length;
      const totalUnsubClicked = sends.filter((s) => s.unsubscribeClicked).length;

      // Per-locale breakdown
      const byLocale: Record<string, { sent: number; opened: number; clicked: number; bounced: number }> = {};
      for (const s of sends) {
        const loc = String(s.merchant?.language || "TR").toUpperCase();
        if (!byLocale[loc]) byLocale[loc] = { sent: 0, opened: 0, clicked: 0, bounced: 0 };
        byLocale[loc].sent++;
        if (s.openedAt)             byLocale[loc].opened++;
        if (s.clickedAt)            byLocale[loc].clicked++;
        if (s.status === "failed")  byLocale[loc].bounced++;
      }

      // Top subjects (by open rate, min 5 sends to be meaningful)
      const subjectAgg: Record<string, { sent: number; opened: number; clicked: number }> = {};
      for (const s of sends) {
        const subj = s.subject || "(empty)";
        if (!subjectAgg[subj]) subjectAgg[subj] = { sent: 0, opened: 0, clicked: 0 };
        subjectAgg[subj].sent++;
        if (s.openedAt)  subjectAgg[subj].opened++;
        if (s.clickedAt) subjectAgg[subj].clicked++;
      }
      const topSubjects = Object.entries(subjectAgg)
        .filter(([, v]) => v.sent >= 5)
        .map(([subject, v]) => ({
          subject,
          sent: v.sent,
          opened: v.opened,
          clicked: v.clicked,
          openRate:  Math.round((v.opened / v.sent) * 100),
          clickRate: Math.round((v.clicked / v.sent) * 100)
        }))
        .sort((a, b) => b.openRate - a.openRate)
        .slice(0, TOP_SUBJECT_LIMIT);

      res.json({
        success: true,
        data: {
          windowDays: WINDOW_DAYS,
          totals: {
            sent: totalSent,
            delivered: totalDelivered,
            opened: totalOpened,
            clicked: totalClicked,
            bounced: totalBounced,
            unsubClicked: totalUnsubClicked,
            openRate:    totalSent ? Math.round((totalOpened  / totalSent) * 100) : 0,
            clickRate:   totalSent ? Math.round((totalClicked / totalSent) * 100) : 0,
            bounceRate:  totalSent ? Math.round((totalBounced / totalSent) * 100) : 0,
            unsubRate:   totalSent ? Math.round((totalUnsubClicked / totalSent) * 100) : 0
          },
          byLocale,
          topSubjects
        }
      });
    } catch (err: any) {
      console.error("[admin/email-engagement.getStats] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load engagement stats" });
    }
  }),

  // GET /api/admin/email-engagement/bounced — currently auto-disabled subs.
  getBounced: h(async (_req: Request, res: Response): Promise<void> => {
    try {
      const subs = await prisma.morningBriefSubscription.findMany({
        where:   { OR: [{ enabled: false, bounceCount: { gte: 3 } }, { bounceCount: { gte: 1 } }] },
        orderBy: { updatedAt: "desc" },
        take:    BOUNCED_LIST_LIMIT,
        include: {
          merchant: { select: { name: true, businessName: true, email: true, language: true } }
        }
      });
      const items = subs.map((s) => ({
        merchantId:   s.merchantId,
        merchantName: s.merchant.businessName || s.merchant.name,
        email:        s.merchant.email,
        enabled:      s.enabled,
        bounceCount:  s.bounceCount,
        lastSentAt:   s.lastSentAt,
        autoDisabled: !s.enabled && s.bounceCount >= 3
      }));
      res.json({ success: true, data: { items, windowDays: WINDOW_DAYS } });
    } catch (err: any) {
      console.error("[admin/email-engagement.getBounced] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load bounced list" });
    }
  }),

  // POST /api/admin/email-engagement/:merchantId/re-enable
  // Manual override: clear the bounce counter and re-enable the
  // subscription. Used when ops verifies the bounce was transient.
  reEnable: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = String(req.params.merchantId || "");
    if (!merchantId) { res.status(400).json({ success: false, error: "merchantId_required" }); return; }
    try {
      const updated = await prisma.morningBriefSubscription.update({
        where: { merchantId },
        data:  { enabled: true, bounceCount: 0, pausedUntil: null }
      });
      res.json({ success: true, data: { subscription: { merchantId: updated.merchantId, enabled: updated.enabled, bounceCount: updated.bounceCount } } });
    } catch (err: any) {
      console.error("[admin/email-engagement.reEnable] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to re-enable subscription" });
    }
  })
};
