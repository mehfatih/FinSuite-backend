// ================================================================
// Sprint D-5 — Public, token-gated unsubscribe / preference change
// for the morning brief email.
//
// Token comes from buildUnsubUrl() in services/morningBrief/
// unsubscribeToken.ts (90-day signed JWT scoped to a merchant id).
// No login required — the token IS the credential.
//
//   GET  /api/morning-brief/unsubscribe/info?token=...
//        → { ok, merchantName, subscription: { enabled, frequency,
//            sendHourLocal, weeklyDay, pausedUntil } }
//
//   POST /api/morning-brief/unsubscribe
//        body: { token, action: 'unsubscribe'|'pause30'|'weekly',
//                reasons?: string[] }
//        → { ok, action, subscription }
//
// Both endpoints stamp `unsubscribeClicked=true` on the most recent
// MorningBriefSend row so engagement analytics know the merchant
// engaged with the unsubscribe flow regardless of action.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { verifyUnsubToken } from "../services/morningBrief/unsubscribeToken";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const VALID_ACTIONS = new Set(["unsubscribe", "pause30", "weekly"]);
const PAUSE_DAYS = 30;

function loadMerchantFromToken(req: Request): { merchantId: string; error?: string } {
  const tokenRaw =
    typeof req.query.token === "string" ? req.query.token
    : typeof req.body?.token === "string" ? req.body.token
    : "";
  if (!tokenRaw) return { merchantId: "", error: "missing_token" };
  const decoded = verifyUnsubToken(tokenRaw);
  if (!decoded) return { merchantId: "", error: "invalid_or_expired_token" };
  return { merchantId: decoded.merchantId };
}

async function stampClickedOnLatestSend(merchantId: string): Promise<void> {
  try {
    const latest = await prisma.morningBriefSend.findFirst({
      where:   { merchantId },
      orderBy: { sentAt: "desc" },
      select:  { id: true }
    });
    if (latest) {
      await prisma.morningBriefSend.update({
        where: { id: latest.id },
        data:  { unsubscribeClicked: true }
      });
    }
  } catch (err: any) {
    console.error("[morning-brief/unsubscribe] stampClickedOnLatestSend failed:", err?.message || err);
  }
}

export const morningBriefUnsubscribeController = {
  // GET /api/morning-brief/unsubscribe/info?token=...
  getInfo: h(async (req: Request, res: Response): Promise<void> => {
    const { merchantId, error } = loadMerchantFromToken(req);
    if (error) { res.status(401).json({ ok: false, error }); return; }

    const merchant = await prisma.merchant.findUnique({
      where:  { id: merchantId },
      select: { name: true, businessName: true, language: true, email: true }
    }).catch(() => null);
    if (!merchant) { res.status(404).json({ ok: false, error: "merchant_not_found" }); return; }

    const sub = await prisma.morningBriefSubscription.findUnique({
      where: { merchantId }
    }).catch(() => null);

    res.json({
      ok: true,
      merchant: {
        name:         merchant.businessName || merchant.name,
        emailMasked:  maskEmail(merchant.email),
        language:     String(merchant.language || "TR").toLowerCase()
      },
      subscription: sub ? {
        enabled:       sub.enabled,
        frequency:     sub.frequency,
        weeklyDay:     sub.weeklyDay,
        sendHourLocal: sub.sendHourLocal,
        pausedUntil:   sub.pausedUntil,
        bounceCount:   sub.bounceCount
      } : null
    });
  }),

  // POST /api/morning-brief/unsubscribe
  apply: h(async (req: Request, res: Response): Promise<void> => {
    const { merchantId, error } = loadMerchantFromToken(req);
    if (error) { res.status(401).json({ ok: false, error }); return; }

    const action = String(req.body?.action || "");
    if (!VALID_ACTIONS.has(action)) {
      res.status(400).json({ ok: false, error: "invalid_action" });
      return;
    }

    const reasonsRaw = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
    const reasons   = reasonsRaw.filter((r: any) => typeof r === "string").slice(0, 8).map((s: string) => s.slice(0, 64));

    // Upsert so a token still works even if the subscription row was
    // never created (early-onboarded merchants from before D-5).
    let subscription;
    try {
      if (action === "unsubscribe") {
        subscription = await prisma.morningBriefSubscription.upsert({
          where:  { merchantId },
          update: { enabled: false, pausedUntil: null },
          create: { merchantId, enabled: false }
        });
      } else if (action === "pause30") {
        const until = new Date(Date.now() + PAUSE_DAYS * 24 * 60 * 60 * 1000);
        subscription = await prisma.morningBriefSubscription.upsert({
          where:  { merchantId },
          update: { enabled: true, pausedUntil: until },
          create: { merchantId, enabled: true, pausedUntil: until }
        });
      } else { // 'weekly'
        // Weekly defaults to Monday (1) so users always have a sensible
        // first day; they can change it in /settings/notifications.
        subscription = await prisma.morningBriefSubscription.upsert({
          where:  { merchantId },
          update: { enabled: true, frequency: "weekly", weeklyDay: 1, pausedUntil: null },
          create: { merchantId, enabled: true, frequency: "weekly", weeklyDay: 1 }
        });
      }
    } catch (err: any) {
      console.error("[morning-brief/unsubscribe] upsert failed:", err?.message || err);
      res.status(500).json({ ok: false, error: "subscription_update_failed" });
      return;
    }

    // Best-effort: mark the latest send row as having been clicked-from.
    // Reasons are stored on AdminNotification rather than the subscription
    // row to avoid schema sprawl; they're surfaced in the admin engagement
    // dashboard (B.9).
    void stampClickedOnLatestSend(merchantId);

    if (reasons.length > 0) {
      await prisma.adminNotification.create({
        data: {
          type:     "morning-brief-unsubscribe-feedback",
          severity: "info",
          title:    `Unsubscribe feedback from merchant ${merchantId}`,
          message:  `Action=${action}; reasons=${reasons.join(", ")}`,
          link:     `/admin/email-engagement?merchantId=${encodeURIComponent(merchantId)}`
        }
      }).catch((err) => console.error("[morning-brief/unsubscribe] feedback admin notif failed:", err?.message || err));
    }

    res.json({
      ok: true,
      action,
      subscription: {
        enabled:       subscription.enabled,
        frequency:     subscription.frequency,
        weeklyDay:     subscription.weeklyDay,
        sendHourLocal: subscription.sendHourLocal,
        pausedUntil:   subscription.pausedUntil
      }
    });
  })
};

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
