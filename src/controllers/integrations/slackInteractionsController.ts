// ================================================================
// Sprint D-9 — Slack interactive-component webhook controller.
//
//   POST /api/integrations/slack/interactions
//
// Mounted with express.raw() upstream (signature verification needs
// the raw bytes). The body is a single form field `payload` whose
// value is a URL-encoded JSON string. Re-verify signing secret on
// every request — Slack's pen-test guidance is explicit about this.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { getSlackConfig } from "../../services/integrations/slack/config";
import { verifySlackSignature } from "../../services/integrations/slack/signature";
import { routeInteraction, InteractionPayload } from "../../services/integrations/slack/interactionRouter";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

function plain(res: Response, status: number, msg: string): void {
  res.status(status).type("text/plain").send(msg);
}

function pickLocale(merchantLanguage: string | null | undefined): "tr" | "en" | "ar" {
  const lang = String(merchantLanguage || "").toUpperCase();
  if (lang === "EN") return "en";
  if (lang === "AR") return "ar";
  return "tr";
}

export const slackInteractionsController = {
  // POST /api/integrations/slack/interactions
  // Public — Slack signing-secret HMAC IS the credential.
  handle: h(async (req: Request, res: Response): Promise<void> => {
    const cfg = getSlackConfig();
    if (!cfg) { plain(res, 503, "Slack integration not configured."); return; }

    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    if (rawBody.length === 0) { plain(res, 400, "Empty body."); return; }

    const verify = verifySlackSignature({
      rawBody,
      timestamp:     String(req.headers["x-slack-request-timestamp"] || ""),
      signature:     String(req.headers["x-slack-signature"] || ""),
      signingSecret: cfg.signingSecret
    });
    if (!verify.ok) {
      console.warn(`[slack/interactions] signature verification failed: ${verify.reason}`);
      plain(res, 401, "Invalid signature.");
      return;
    }

    // Body shape: payload=<url-encoded JSON>
    const params = new URLSearchParams(rawBody.toString("utf8"));
    const rawPayload = params.get("payload");
    if (!rawPayload) { plain(res, 400, "Missing payload."); return; }

    let payload: InteractionPayload;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      plain(res, 400, "Invalid payload JSON.");
      return;
    }

    const teamId = payload?.team?.id;
    if (!teamId) {
      // Some payload types (`view_submission` modals) carry a different shape;
      // V1 routes only "block_actions". Anything else is acked silently so
      // Slack stops retrying.
      res.status(200).end();
      return;
    }

    const installation = await prisma.slackInstallation.findFirst({
      where: { workspaceId: teamId, uninstalledAt: null },
      include: { merchant: { select: { id: true, language: true } } }
    });
    if (!installation) {
      // Slack workspace isn't connected — could happen mid-uninstall.
      // Reply 200 so Slack doesn't retry.
      res.status(200).end();
      return;
    }

    const locale = pickLocale(installation.merchant?.language);

    try {
      const reply = await routeInteraction({
        payload,
        merchantId: installation.merchantId,
        locale,
        prisma
      });
      if (reply.kind === "ack") {
        res.status(200).end();
        return;
      }
      res.status(200).json(reply.body);
    } catch (err: any) {
      console.error("[slack/interactions] router error:", err?.message || err);
      res.status(200).end(); // never let Slack retry on our handler bugs
    }
  })
};
