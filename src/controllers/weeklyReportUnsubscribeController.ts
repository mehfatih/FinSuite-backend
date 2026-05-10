// ================================================================
// Sprint D-6 — Public, token-gated weekly-report unsubscribe API.
// Mirrors D-5's morning-brief unsubscribe shape.
//
//   GET  /api/weekly-report/unsubscribe/info?token=...
//   POST /api/weekly-report/unsubscribe
//        body: { token, action: 'unsubscribe'|'pause30'|'biweekly',
//                reasons?: string[] }
//
// Token namespace: weekly-report-unsub:<merchantId> (decision §6.G
// option G1 — distinct from D-5's morning-brief tokens).
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { verifyUnsubToken } from "../services/weeklyReport/unsubscribeToken";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const VALID_ACTIONS = new Set(["unsubscribe", "pause30", "biweekly"]);
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
    const latest = await prisma.weeklyReportSend.findFirst({
      where:   { merchantId },
      orderBy: { sentAt: "desc" },
      select:  { id: true }
    });
    if (latest) {
      await prisma.weeklyReportSend.update({
        where: { id: latest.id },
        data:  { unsubscribeClicked: true }
      });
    }
  } catch (err: any) {
    console.error("[weeklyReport/unsubscribe] stampClickedOnLatestSend failed:", err?.message || err);
  }
}

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export const weeklyReportUnsubscribeController = {
  // GET /info — render-friendly merchant + subscription snapshot
  getInfo: h(async (req: Request, res: Response): Promise<void> => {
    const { merchantId, error } = loadMerchantFromToken(req);
    if (error) { res.status(401).json({ ok: false, error }); return; }

    const merchant = await prisma.merchant.findUnique({
      where:  { id: merchantId },
      select: { name: true, businessName: true, language: true, email: true }
    }).catch(() => null);
    if (!merchant) { res.status(404).json({ ok: false, error: "merchant_not_found" }); return; }

    const sub = await prisma.weeklyReportSubscription.findUnique({
      where: { merchantId }
    }).catch(() => null);

    res.json({
      ok: true,
      merchant: {
        name:        merchant.businessName || merchant.name,
        emailMasked: maskEmail(merchant.email),
        language:    String(merchant.language || "TR").toLowerCase()
      },
      subscription: sub ? {
        enabled:       sub.enabled,
        sendDayLocal:  sub.sendDayLocal,
        sendHourLocal: sub.sendHourLocal,
        pausedUntil:   sub.pausedUntil,
        bounceCount:   sub.bounceCount
      } : null
    });
  }),

  // POST / — apply action
  apply: h(async (req: Request, res: Response): Promise<void> => {
    const { merchantId, error } = loadMerchantFromToken(req);
    if (error) { res.status(401).json({ ok: false, error }); return; }

    const action = String(req.body?.action || "");
    if (!VALID_ACTIONS.has(action)) {
      res.status(400).json({ ok: false, error: "invalid_action" });
      return;
    }

    const reasonsRaw = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
    const reasons   = reasonsRaw
      .filter((r: any) => typeof r === "string")
      .slice(0, 8)
      .map((s: string) => s.slice(0, 64));

    let subscription;
    try {
      if (action === "unsubscribe") {
        subscription = await prisma.weeklyReportSubscription.upsert({
          where:  { merchantId },
          update: { enabled: false, pausedUntil: null },
          create: { merchantId, enabled: false }
        });
      } else if (action === "pause30") {
        const until = new Date(Date.now() + PAUSE_DAYS * 24 * 60 * 60 * 1000);
        subscription = await prisma.weeklyReportSubscription.upsert({
          where:  { merchantId },
          update: { enabled: true, pausedUntil: until },
          create: { merchantId, enabled: true, pausedUntil: until }
        });
      } else { // 'biweekly' — pause 1 week (skip the next send only)
        const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        subscription = await prisma.weeklyReportSubscription.upsert({
          where:  { merchantId },
          update: { enabled: true, pausedUntil: until },
          create: { merchantId, enabled: true, pausedUntil: until }
        });
      }
    } catch (err: any) {
      console.error("[weeklyReport/unsubscribe] upsert failed:", err?.message || err);
      res.status(500).json({ ok: false, error: "subscription_update_failed" });
      return;
    }

    void stampClickedOnLatestSend(merchantId);

    if (reasons.length > 0) {
      await prisma.adminNotification.create({
        data: {
          type:     "weekly-report-unsubscribe-feedback",
          severity: "info",
          title:    `Weekly report unsubscribe feedback from ${merchantId}`,
          message:  `Action=${action}; reasons=${reasons.join(", ")}`,
          link:     `/admin/email-engagement?merchantId=${encodeURIComponent(merchantId)}`
        }
      }).catch((err) => console.error("[weeklyReport/unsubscribe] feedback admin notif failed:", err?.message || err));
    }

    res.json({
      ok: true,
      action,
      subscription: {
        enabled:       subscription.enabled,
        sendDayLocal:  subscription.sendDayLocal,
        sendHourLocal: subscription.sendHourLocal,
        pausedUntil:   subscription.pausedUntil
      }
    });
  })
};
