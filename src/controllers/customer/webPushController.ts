// ================================================================
// webPushController.ts — Sprint D-4.
//   GET    /api/customer/web-push/vapid-key   → public key (NOT secret)
//   POST   /api/customer/web-push/subscribe   → register endpoint+keys
//   DELETE /api/customer/web-push/unsubscribe → remove subscription
//
// The public key is served from process.env.VAPID_PUBLIC_KEY so the
// frontend never hardcodes it. The frontend fetches this once at
// permission-prompt time, derives `applicationServerKey` from it,
// and registers the subscription via POST /subscribe.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const webPushController = {

  // GET /api/customer/web-push/vapid-key
  // Public key only. Auth-required so we don't leak it to scrapers,
  // even though the public key isn't a secret.
  vapidKey: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const publicKey = process.env.VAPID_PUBLIC_KEY || "";
      if (!publicKey) {
        res.status(503).json({ success: false, error: "Web Push is not configured on the server." });
        return;
      }
      res.status(200).json({ success: true, data: { publicKey } });
    } catch (err: any) {
      console.error("[web-push/vapid-key] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load VAPID key." });
    }
  }),

  // POST /api/customer/web-push/subscribe
  // Body: { endpoint, keys: { p256dh, auth }, userAgent? }
  subscribe: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const endpoint  = String(req.body?.endpoint || "").slice(0, 1500);
      const p256dh    = String(req.body?.keys?.p256dh || "").slice(0, 200);
      const auth      = String(req.body?.keys?.auth   || "").slice(0, 80);
      const userAgent = req.body?.userAgent ? String(req.body.userAgent).slice(0, 200) : null;

      if (!endpoint || !p256dh || !auth) {
        res.status(400).json({ success: false, error: "endpoint + keys.p256dh + keys.auth are required." });
        return;
      }

      // Upsert by endpoint (the unique constraint).
      const sub = await prisma.webPushSubscription.upsert({
        where:  { endpoint },
        update: { merchantId: userId, p256dh, auth, userAgent, lastSeenAt: new Date() },
        create: { merchantId: userId, endpoint, p256dh, auth, userAgent }
      });
      res.status(200).json({ success: true, data: { subscriptionId: sub.id } });
    } catch (err: any) {
      console.error("[web-push/subscribe] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to register subscription." });
    }
  }),

  // DELETE /api/customer/web-push/unsubscribe
  // Body: { endpoint }
  unsubscribe: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const endpoint = String(req.body?.endpoint || "");
      if (!endpoint) { res.status(400).json({ success: false, error: "endpoint is required." }); return; }

      await prisma.webPushSubscription.deleteMany({
        where: { endpoint, merchantId: userId }
      });
      res.status(200).json({ success: true, data: { unsubscribed: true } });
    } catch (err: any) {
      console.error("[web-push/unsubscribe] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to unsubscribe." });
    }
  })
};
