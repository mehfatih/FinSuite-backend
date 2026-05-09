// ================================================================
// channels/webPushChannel.ts — VAPID Web Push driver.
// Reads VAPID config from process.env (single source of truth);
// no hardcoded keys in the codebase. Sends a push payload to every
// subscription registered for the merchant; prunes subscriptions
// that return 404 / 410 (browser unsubscribed).
// ================================================================
import webpush from "web-push";
import { prisma } from "../../../config/database";
import type { ChannelDriver, ChannelResult } from "../types";

let configured = false;

/**
 * One-shot configuration. Safe to call multiple times — internal
 * idempotency. Returns true if VAPID is fully configured (env vars
 * present + non-empty); false otherwise.
 */
export function configureWebPush(): boolean {
  if (configured) return true;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub  = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !sub) {
    console.warn("[webPushChannel] VAPID env vars missing; channel disabled.");
    return false;
  }
  webpush.setVapidDetails(sub, pub, priv);
  configured = true;
  console.log("[webPushChannel] VAPID configured.");
  return true;
}

export const webPushChannel: ChannelDriver = {
  channel: "webpush",
  async send({ event, notification }): Promise<ChannelResult> {
    if (!configureWebPush()) {
      return { channel: "webpush", success: false, error: "vapid_not_configured" };
    }
    try {
      const subs = await prisma.webPushSubscription.findMany({
        where: { merchantId: event.merchantId }
      });
      if (subs.length === 0) {
        return { channel: "webpush", success: false, error: "no_subscriptions" };
      }

      const payload = JSON.stringify({
        notificationId: notification?.id || null,
        title:          event.title.slice(0, 120),
        body:           event.body.slice(0, 280),
        severity:       event.severity,
        iconTone:       event.iconTone,
        ctaRoute:       event.ctaRoute || "/notifications",
        // Tag groups duplicates in the OS notification center.
        tag:            `zyrix-${event.severity}-${event.merchantId}`
      });

      const results = await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          // Best-effort: stamp lastSeenAt on success.
          await prisma.webPushSubscription.update({
            where: { id: s.id },
            data:  { lastSeenAt: new Date() }
          }).catch(() => undefined);
          return { id: s.id, ok: true };
        } catch (err: any) {
          const code = err?.statusCode;
          // 404 / 410 → browser dropped subscription; prune.
          if (code === 404 || code === 410) {
            await prisma.webPushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          }
          return { id: s.id, ok: false, code, msg: err?.body || err?.message };
        }
      }));

      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        return { channel: "webpush", success: false, error: `no_recipients_reachable: ${JSON.stringify(results.slice(0, 3))}` };
      }
      return { channel: "webpush", success: true, refId: `${okCount}/${subs.length}` };
    } catch (err: any) {
      return { channel: "webpush", success: false, error: err?.message || String(err) };
    }
  }
};
