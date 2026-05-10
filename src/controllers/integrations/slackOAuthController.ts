// ================================================================
// Sprint D-9 — Slack OAuth flow.
//
//   GET  /api/integrations/slack/install          — auth-required;
//                                                    redirects to Slack
//                                                    /oauth/v2/authorize
//                                                    with signed state.
//   GET  /api/integrations/slack/oauth-callback   — public (state IS the
//                                                    credential); exchanges
//                                                    code, encrypts + persists
//                                                    bot token, redirects to
//                                                    /settings/integrations.
//   POST /api/integrations/slack/uninstall/:id    — auth-required; revokes
//                                                    bot token, soft-deletes.
//   GET  /api/integrations/slack                  — auth-required; lists
//                                                    merchant's installations.
//
// Per deferred-env-vars rule: any endpoint where Slack isn't configured
// returns 503 cleanly. Server boot is unaffected.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { encrypt, decrypt } from "../../utils/encryption";
import {
  getSlackConfig,
  buildAuthorizeUrl,
  SLACK_BOT_SCOPES
} from "../../services/integrations/slack/config";
import { signSlackState, verifySlackState } from "../../services/integrations/slack/stateToken";
import { exchangeOAuthCode, authRevoke, SlackApiError } from "../../services/integrations/slack/client";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// Where the user lands after the OAuth dance (frontend page that polls
// /api/integrations/slack to show the new installation).
const APP_BASE_URL = (process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co").replace(/\/$/, "");
const RETURN_PATH  = "/settings/integrations";

function notConfigured(res: Response): void {
  res.status(503).json({
    success: false,
    error:   "Slack integration not configured.",
    code:    "slack_not_configured",
    hint:    "Provision SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET, SLACK_REDIRECT_URI, SLACK_APP_ID on Railway."
  });
}

function payloadOf(row: any) {
  return {
    id:               row.id,
    workspaceId:      row.workspaceId,
    workspaceName:    row.workspaceName,
    botUserId:        row.botUserId,
    scope:            row.scope,
    installedAt:      row.installedAt,
    uninstalledAt:    row.uninstalledAt,
    hasIncomingWebhook: !!row.incomingWebhookUrl
  };
}

export const slackOAuthController = {
  // GET /api/integrations/slack — auth-required list of installations.
  list: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const rows = await prisma.slackInstallation.findMany({
      where:   { merchantId },
      orderBy: { installedAt: "desc" }
    });
    res.json({
      success: true,
      data: {
        configured:    !!getSlackConfig(),
        installations: rows.map(payloadOf)
      }
    });
  }),

  // GET /api/integrations/slack/install — start OAuth.
  install: h(async (req: Request, res: Response): Promise<void> => {
    const cfg = getSlackConfig();
    if (!cfg) { notConfigured(res); return; }

    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const state = signSlackState(merchantId);
    const url   = buildAuthorizeUrl({
      clientId:    cfg.clientId,
      redirectUri: cfg.redirectUri,
      scopes:      SLACK_BOT_SCOPES,
      state
    });
    res.json({ success: true, data: { url } });
  }),

  // GET /api/integrations/slack/oauth-callback — public; state is the credential.
  callback: h(async (req: Request, res: Response): Promise<void> => {
    const cfg = getSlackConfig();
    if (!cfg) { notConfigured(res); return; }

    const code  = String(req.query.code  || "");
    const state = String(req.query.state || "");
    const err   = String(req.query.error || "");

    if (err) {
      // User denied or Slack errored — bounce back to settings with toast.
      res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=error&reason=${encodeURIComponent(err)}`);
      return;
    }
    if (!code || !state) {
      res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=error&reason=missing_params`);
      return;
    }

    let merchantId: string;
    try {
      const payload = verifySlackState(state);
      merchantId = payload.merchantId;
    } catch {
      res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=error&reason=bad_state`);
      return;
    }

    let oauth;
    try {
      oauth = await exchangeOAuthCode({
        code,
        clientId:     cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri:  cfg.redirectUri
      });
    } catch (e) {
      const reason = e instanceof SlackApiError ? e.slackError : "exchange_failed";
      res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=error&reason=${encodeURIComponent(reason)}`);
      return;
    }

    try {
      await prisma.slackInstallation.upsert({
        where:  { merchantId_workspaceId: { merchantId, workspaceId: oauth.team.id } },
        create: {
          merchantId,
          workspaceId:        oauth.team.id,
          workspaceName:      oauth.team.name,
          botToken:           encrypt(oauth.access_token),
          botUserId:          oauth.bot_user_id,
          incomingWebhookUrl: oauth.incoming_webhook?.url ? encrypt(oauth.incoming_webhook.url) : null,
          scope:              oauth.scope,
          uninstalledAt:      null
        },
        update: {
          // Re-install of the same workspace: rotate the token, clear soft-delete.
          workspaceName:      oauth.team.name,
          botToken:           encrypt(oauth.access_token),
          botUserId:          oauth.bot_user_id,
          incomingWebhookUrl: oauth.incoming_webhook?.url ? encrypt(oauth.incoming_webhook.url) : null,
          scope:              oauth.scope,
          uninstalledAt:      null,
          installedAt:        new Date()
        }
      });

      // Flip the master toggle on the merchant's notification preference
      // so the channel driver actually fires after the first install.
      await prisma.notificationPreference.upsert({
        where:  { merchantId },
        create: { merchantId, slackEnabled: true },
        update: { slackEnabled: true }
      });
    } catch (e: any) {
      console.error("[slack/oauth] persist failed:", e?.message || e);
      res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=error&reason=persist_failed`);
      return;
    }

    res.redirect(`${APP_BASE_URL}${RETURN_PATH}?slack=connected&workspace=${encodeURIComponent(oauth.team.name)}`);
  }),

  // POST /api/integrations/slack/uninstall/:id
  uninstall: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const id = String(req.params.id || "");
    const row = await prisma.slackInstallation.findFirst({
      where: { id, merchantId }
    });
    if (!row) { res.status(404).json({ success: false, error: "Installation not found." }); return; }
    if (row.uninstalledAt) {
      res.json({ success: true, data: payloadOf(row) }); return;
    }

    // Best-effort revoke; ignore failure (token might already be invalid).
    try {
      const decrypted = decrypt(row.botToken);
      await authRevoke(decrypted);
    } catch (e: any) {
      console.warn("[slack/uninstall] auth.revoke failed:", e?.message || e);
    }

    const updated = await prisma.slackInstallation.update({
      where: { id },
      data:  { uninstalledAt: new Date() }
    });

    // If this was the merchant's last active install, flip the master
    // toggle back off so the engine doesn't try to dispatch.
    const stillActive = await prisma.slackInstallation.count({
      where: { merchantId, uninstalledAt: null }
    });
    if (stillActive === 0) {
      await prisma.notificationPreference.upsert({
        where:  { merchantId },
        create: { merchantId, slackEnabled: false },
        update: { slackEnabled: false }
      });
    }

    res.json({ success: true, data: payloadOf(updated) });
  })
};
