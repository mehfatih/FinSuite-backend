// ================================================================
// resendWebhookController.ts — Sprint D-4 (D-3 follow-up).
//   POST /api/webhooks/resend
//
// Verifies Svix-style signature using process.env.RESEND_WEBHOOK_SECRET,
// then maps Resend event types to InsightShare row updates and fires
// share events into the notification engine.
//
// Critical: this route MUST receive the raw request body for HMAC
// verification. The route file mounts express.raw() — DO NOT add
// express.json() above this controller.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../../config/database";
import { emitShareEvent } from "../../services/sharing/shareEvents";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// Resend / Svix signature header format: `v1,<base64-signature> v1,<another>`
// (multiple signatures supported during secret rotation). We verify ANY
// signature matches the expected HMAC.
function verifySvixSignature(args: {
  rawBody:    Buffer;
  msgId:      string;
  timestamp:  string;
  signatures: string[];
  secret:     string;
}): boolean {
  // Resend signing secret format: `whsec_<base64>`. Strip the prefix.
  let secret = args.secret;
  if (secret.startsWith("whsec_")) secret = secret.slice("whsec_".length);
  let key: Buffer;
  try { key = Buffer.from(secret, "base64"); }
  catch { return false; }

  const toSign = `${args.msgId}.${args.timestamp}.${args.rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", key).update(toSign).digest("base64");

  for (const sig of args.signatures) {
    const tag = sig.split(",")[1] || "";
    try {
      if (crypto.timingSafeEqual(Buffer.from(tag, "base64"), Buffer.from(expected, "base64"))) {
        return true;
      }
    } catch { /* length mismatch — try next */ }
  }
  return false;
}

export const resendWebhookController = {
  // POST /api/webhooks/resend
  // Public — auth via signature header.
  handle: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const secret = process.env.RESEND_WEBHOOK_SECRET || "";
    if (!secret) {
      console.error("[webhooks/resend] RESEND_WEBHOOK_SECRET not set; rejecting.");
      res.status(503).type("text/plain").send("Webhook secret not configured.");
      return;
    }

    const msgId      = String(req.headers["svix-id"]        || "");
    const timestamp  = String(req.headers["svix-timestamp"] || "");
    const sigHeader  = String(req.headers["svix-signature"] || "");
    if (!msgId || !timestamp || !sigHeader) {
      res.status(400).type("text/plain").send("Missing svix headers.");
      return;
    }

    // express.raw() puts the raw body on req.body as a Buffer.
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    if (rawBody.length === 0) {
      res.status(400).type("text/plain").send("Empty body.");
      return;
    }

    // Reject signatures > 5 minutes old (replay protection).
    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) {
      res.status(401).type("text/plain").send("Stale signature.");
      return;
    }

    const signatures = sigHeader.split(/\s+/).filter(Boolean);
    if (!verifySvixSignature({ rawBody, msgId, timestamp, signatures, secret })) {
      console.warn("[webhooks/resend] signature verification failed.");
      res.status(401).type("text/plain").send("Invalid signature.");
      return;
    }

    let payload: any;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { res.status(400).type("text/plain").send("Invalid JSON."); return; }

    const eventType = String(payload?.type || "");
    const data      = payload?.data || {};
    const emailId   = String(data?.email_id || data?.id || "");

    if (!emailId) {
      // Some event types don't have email_id (e.g. `email.bounced` complaint).
      // Acknowledge so Resend doesn't retry.
      res.status(200).json({ success: true, ignored: "no_email_id" });
      return;
    }

    try {
      const share = await prisma.insightShare.findFirst({
        where: { providerMessageId: emailId }
      });

      if (eventType === "email.delivered") {
        if (share && !share.deliveredAt) {
          await prisma.insightShare.update({
            where: { id: share.id },
            data:  { deliveredAt: new Date(), status: share.status === "sent" ? "delivered" : share.status }
          });
          emitShareEvent({
            type: "share.delivered",
            shareId: share.id,
            merchantId: share.merchantId,
            channel: (share.channel as "email" | "whatsapp")
          });
        }
        res.status(200).json({ success: true, handled: "email.delivered" });
        return;
      }

      if (eventType === "email.opened") {
        if (share && !share.openedAt) {
          await prisma.insightShare.update({
            where: { id: share.id },
            data:  { openedAt: new Date(), status: "opened" }
          });
          emitShareEvent({
            type: "share.opened",
            shareId: share.id,
            merchantId: share.merchantId,
            channel: (share.channel as "email" | "whatsapp")
          });
        }
        res.status(200).json({ success: true, handled: "email.opened" });
        return;
      }

      if (eventType === "email.bounced" || eventType === "email.complained") {
        if (share) {
          await prisma.insightShare.update({
            where: { id: share.id },
            data:  { status: "failed", errorMessage: `${eventType}: ${data?.bounce_type || data?.feedback_type || "unknown"}` }
          });
        }
        res.status(200).json({ success: true, handled: eventType });
        return;
      }

      // Unhandled event types acknowledged so Resend doesn't retry.
      res.status(200).json({ success: true, ignored: eventType });
    } catch (err: any) {
      console.error("[webhooks/resend] handler error:", err?.message || err);
      res.status(500).json({ success: false, error: "Handler failed." });
    }
  })
};
