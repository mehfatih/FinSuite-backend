// ================================================================
// Sprint D-5 — Customer-side morning brief preferences CRUD.
//   GET   /api/customer/morning-brief          — returns subscription
//   PATCH /api/customer/morning-brief          — updates preferences
//   POST  /api/customer/morning-brief/test     — sends a one-off send
//   GET   /api/customer/morning-brief/stats    — last-30-days engagement
//
// All authenticated; merchantId comes from req.merchant.id.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { sendMorningBrief } from "../../services/morningBrief/sendBrief";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_FREQ = new Set(["daily", "weekdays", "weekly", "never"]);

const TEST_SEND_RATELIMIT_MS = 60_000;
const lastTestAt = new Map<string, number>();

const DEFAULTS = {
  enabled:       true,
  frequency:     "daily",
  weeklyDay:     null as number | null,
  sendHourLocal: 7,
  pausedUntil:   null as Date | null,
  bounceCount:   0,
  variant:       "v1"
};

function payload(row: any | null) {
  if (!row) return { ...DEFAULTS, persisted: false };
  return {
    enabled:       row.enabled,
    frequency:     row.frequency,
    weeklyDay:     row.weeklyDay,
    sendHourLocal: row.sendHourLocal,
    pausedUntil:   row.pausedUntil,
    bounceCount:   row.bounceCount,
    variant:       row.variant,
    lastSentAt:    row.lastSentAt,
    persisted:     true
  };
}

export const morningBriefController = {
  // GET — returns subscription OR defaults if no row exists yet.
  get: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const row = await prisma.morningBriefSubscription.findUnique({ where: { merchantId } });
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { timezone: true }
      });
      res.json({
        success: true,
        data: {
          subscription: payload(row),
          timezone:     merchant?.timezone || "Europe/Istanbul"
        }
      });
    } catch (err: any) {
      console.error("[customer/morning-brief.get] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load subscription" });
    }
  }),

  // PATCH — partial update with validation.
  update: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const body = req.body || {};
    const patch: any = {};

    if (typeof body.enabled === "boolean")            patch.enabled = body.enabled;
    if (typeof body.frequency === "string") {
      if (!ALLOWED_FREQ.has(body.frequency)) {
        res.status(400).json({ success: false, error: "invalid_frequency" }); return;
      }
      patch.frequency = body.frequency;
    }
    if (body.weeklyDay === null || body.weeklyDay === undefined) {
      // explicit null clears
      if ("weeklyDay" in body) patch.weeklyDay = null;
    } else if (typeof body.weeklyDay === "number" && body.weeklyDay >= 0 && body.weeklyDay <= 6) {
      patch.weeklyDay = body.weeklyDay;
    }
    if (typeof body.sendHourLocal === "number" && body.sendHourLocal >= 0 && body.sendHourLocal <= 23) {
      patch.sendHourLocal = Math.floor(body.sendHourLocal);
    }
    // Customer can clear an active pause via a UI toggle; cannot directly set
    // pausedUntil to a future date here (that's the unsubscribe-page surface).
    if (body.clearPause === true) patch.pausedUntil = null;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: "no_valid_fields" }); return;
    }

    try {
      const row = await prisma.morningBriefSubscription.upsert({
        where:  { merchantId },
        update: patch,
        create: { merchantId, ...DEFAULTS, ...patch }
      });
      res.json({ success: true, data: { subscription: payload(row) } });
    } catch (err: any) {
      console.error("[customer/morning-brief.update] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update subscription" });
    }
  }),

  // POST /test — fire one immediate send to the merchant's email,
  //              independent of the cron schedule. Rate-limited
  //              1/60s per merchant to bound abuse.
  test: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const last = lastTestAt.get(merchantId) || 0;
    if (Date.now() - last < TEST_SEND_RATELIMIT_MS) {
      const wait = Math.ceil((TEST_SEND_RATELIMIT_MS - (Date.now() - last)) / 1000);
      res.status(429).json({ success: false, error: `rate_limited`, waitSeconds: wait });
      return;
    }
    lastTestAt.set(merchantId, Date.now());

    try {
      const merchant = await prisma.merchant.findUnique({
        where:  { id: merchantId },
        select: { id: true, email: true, name: true, businessName: true, language: true, timezone: true }
      });
      if (!merchant?.email) {
        res.status(400).json({ success: false, error: "merchant_no_email" }); return;
      }
      // Pull or create the subscription so variant is consistent with prod sends.
      const sub = await prisma.morningBriefSubscription.upsert({
        where:  { merchantId },
        update: {},
        create: { merchantId }
      });
      const result = await sendMorningBrief({
        sub: {
          id: sub.id, merchantId, enabled: sub.enabled,
          frequency: sub.frequency, weeklyDay: sub.weeklyDay,
          sendHourLocal: sub.sendHourLocal, lastSentAt: sub.lastSentAt,
          pausedUntil: sub.pausedUntil, bounceCount: sub.bounceCount, variant: sub.variant
        },
        merchant: {
          id: merchant.id, email: merchant.email, timezone: merchant.timezone,
          language: merchant.language as unknown as string,
          name: merchant.name, businessName: merchant.businessName ?? null
        }
      });
      if (!result.ok) {
        res.status(502).json({ success: false, error: result.reason || "send_failed" });
        return;
      }
      res.json({ success: true, data: { sendId: result.sendId } });
    } catch (err: any) {
      console.error("[customer/morning-brief.test] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Test send failed" });
    }
  }),

  // GET /stats — last 30 days aggregate counts for the panel.
  stats: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.morningBriefSend.findMany({
        where:   { merchantId, sentAt: { gte: since } },
        select:  { deliveredAt: true, openedAt: true, clickedAt: true, status: true }
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
      console.error("[customer/morning-brief.stats] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load stats" });
    }
  })
};
