// ================================================================
// Sprint D-9 — Slack slash-command webhook controller.
//
//   POST /api/integrations/slack/commands
//
// Mounted with express.raw() so the raw body buffer is available for
// HMAC verification (mirrors the Resend webhook pattern in
// controllers/webhooks/resendWebhookController.ts).
//
// Body is application/x-www-form-urlencoded with fields:
//   token, team_id, channel_id, user_id, command="/zyrix",
//   text="<subcommand args>", response_url, trigger_id
//
// Slack expects a JSON reply within 3 seconds. Long-running work
// (none in V1) would push to response_url asynchronously.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { getSlackConfig } from "../../services/integrations/slack/config";
import { verifySlackSignature } from "../../services/integrations/slack/signature";
import { routeSlashCommand } from "../../services/integrations/slack/slashCommandRouter";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const APP_BASE_URL = (process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co").replace(/\/$/, "");

function plain(res: Response, status: number, msg: string): void {
  res.status(status).type("text/plain").send(msg);
}

function parseUrlEncodedBody(raw: Buffer): Record<string, string> {
  const params = new URLSearchParams(raw.toString("utf8"));
  const out: Record<string, string> = {};
  params.forEach((value, key) => { out[key] = value; });
  return out;
}

function pickLocale(merchantLanguage: string | null | undefined): "tr" | "en" | "ar" {
  const lang = String(merchantLanguage || "").toUpperCase();
  if (lang === "EN") return "en";
  if (lang === "AR") return "ar";
  return "tr";
}

export const slackCommandsController = {
  // POST /api/integrations/slack/commands
  // Public — Slack signing-secret HMAC is the credential. Mounted with
  // express.raw() upstream.
  handle: h(async (req: Request, res: Response): Promise<void> => {
    const cfg = getSlackConfig();
    if (!cfg) {
      plain(res, 503, "Slack integration not configured.");
      return;
    }

    // Raw body verification (express.raw puts a Buffer on req.body).
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : "");
    if (rawBody.length === 0) {
      plain(res, 400, "Empty body.");
      return;
    }

    const verify = verifySlackSignature({
      rawBody,
      timestamp:     String(req.headers["x-slack-request-timestamp"] || ""),
      signature:     String(req.headers["x-slack-signature"] || ""),
      signingSecret: cfg.signingSecret
    });
    if (!verify.ok) {
      console.warn(`[slack/commands] signature verification failed: ${verify.reason}`);
      plain(res, 401, "Invalid signature.");
      return;
    }

    // Parse form body and resolve which merchant this came from.
    const fields  = parseUrlEncodedBody(rawBody);
    const teamId  = String(fields.team_id || "");
    const command = String(fields.command || "");
    const text    = String(fields.text || "");

    if (!teamId) {
      plain(res, 400, "Missing team_id.");
      return;
    }
    if (command !== "/zyrix") {
      // We only own /zyrix — anything else means this URL was registered
      // for a different command in error.
      res.json({ response_type: "ephemeral", text: "Unsupported command." });
      return;
    }

    const installation = await prisma.slackInstallation.findFirst({
      where: { workspaceId: teamId, uninstalledAt: null },
      include: { merchant: { select: { id: true, language: true, currency: true } } }
    });
    if (!installation) {
      res.json({
        response_type: "ephemeral",
        text: "This Slack workspace isn't connected to a Zyrix merchant. Re-install from /settings/integrations."
      });
      return;
    }

    const merchant = installation.merchant;
    const locale   = pickLocale(merchant?.language);
    const currency = merchant?.currency || "TRY";

    try {
      const reply = await routeSlashCommand({
        text,
        merchantId:  installation.merchantId,
        locale,
        prisma,
        appBaseUrl:  APP_BASE_URL,
        currency
      });
      res.json(reply);
    } catch (err: any) {
      console.error("[slack/commands] route error:", err?.message || err);
      res.json({ response_type: "ephemeral", text: "Command failed. Try again later." });
    }
  })
};
