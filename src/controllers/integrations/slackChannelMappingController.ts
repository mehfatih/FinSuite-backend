// ================================================================
// Sprint D-9 — Slack channel mapping CRUD + test-send.
//
//   GET    /api/integrations/slack/:installationId/channels         — list workspace channels
//   GET    /api/integrations/slack/:installationId/mappings         — list current mappings
//   PUT    /api/integrations/slack/:installationId/mappings         — replace full mapping set (atomic)
//   POST   /api/integrations/slack/:installationId/test-send        — send a test message
//   PATCH  /api/integrations/slack/preferences                      — update slackEnabled + slackChannels per-severity
//
// All authenticated; merchantId from JWT. Resource ownership verified
// on every call (never trust :installationId alone).
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { decrypt } from "../../utils/encryption";
import { getSlackConfig } from "../../services/integrations/slack/config";
import { listConversations, SlackApiError } from "../../services/integrations/slack/client";
import { sendSlackTestMessage } from "../../services/notifications/channels/slackChannel";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_INSIGHT_TYPES = new Set(["CRITICAL", "ATTENTION", "OPPORTUNITY", "SHARE_EVENT", "all"]);
const ALLOWED_SLACK_SEVERITIES = new Set(["CRITICAL", "ATTENTION", "OPPORTUNITY", "SHARE_EVENT"]);

function notConfigured(res: Response): void {
  res.status(503).json({
    success: false,
    error:   "Slack integration not configured.",
    code:    "slack_not_configured"
  });
}

async function loadInstallation(merchantId: string, installationId: string) {
  return prisma.slackInstallation.findFirst({
    where: { id: installationId, merchantId, uninstalledAt: null }
  });
}

function pickLocale(merchantLanguage: string | null | undefined): "tr" | "en" | "ar" {
  const lang = String(merchantLanguage || "").toUpperCase();
  if (lang === "EN") return "en";
  if (lang === "AR") return "ar";
  return "tr";
}

export const slackChannelMappingController = {

  // GET /api/integrations/slack/:installationId/channels
  // Lists Slack channels in the workspace (filtered to ones the bot can post to).
  listChannels: h(async (req: Request, res: Response): Promise<void> => {
    if (!getSlackConfig()) { notConfigured(res); return; }

    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const install = await loadInstallation(merchantId, String(req.params.installationId));
    if (!install) { res.status(404).json({ success: false, error: "Installation not found." }); return; }

    let botToken: string;
    try { botToken = decrypt(install.botToken); }
    catch { res.status(500).json({ success: false, error: "decrypt_failed" }); return; }

    try {
      const data = await listConversations({ botToken, limit: 200 });
      const channels = (data.channels || [])
        .filter((c) => !c.is_archived)
        .map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private || false, isMember: c.is_member || false }));
      res.json({ success: true, data: { channels } });
    } catch (err) {
      const reason = err instanceof SlackApiError ? err.slackError : "list_failed";
      res.status(502).json({ success: false, error: reason });
    }
  }),

  // GET /api/integrations/slack/:installationId/mappings
  listMappings: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const install = await loadInstallation(merchantId, String(req.params.installationId));
    if (!install) { res.status(404).json({ success: false, error: "Installation not found." }); return; }

    const rows = await prisma.slackChannelMapping.findMany({
      where: { installationId: install.id },
      orderBy: { createdAt: "asc" }
    });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id:           r.id,
        insightType:  r.insightType,
        channelId:    r.channelId,
        channelName:  r.channelName,
        enabled:      r.enabled,
        createdAt:    r.createdAt
      }))
    });
  }),

  // PUT /api/integrations/slack/:installationId/mappings
  // Body: { mappings: [{ insightType, channelId, channelName, enabled }] }
  // Replaces the full set atomically — simpler UX than per-row CRUD.
  replaceMappings: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const install = await loadInstallation(merchantId, String(req.params.installationId));
    if (!install) { res.status(404).json({ success: false, error: "Installation not found." }); return; }

    const incoming = Array.isArray((req.body as any)?.mappings) ? (req.body as any).mappings : null;
    if (!incoming) { res.status(400).json({ success: false, error: "mappings array required" }); return; }

    // Validate every row before any DB mutation.
    const sanitized: Array<{ insightType: string; channelId: string; channelName: string; enabled: boolean }> = [];
    for (const m of incoming) {
      const insightType = String(m?.insightType || "");
      const channelId   = String(m?.channelId   || "");
      const channelName = String(m?.channelName || "");
      if (!ALLOWED_INSIGHT_TYPES.has(insightType)) {
        res.status(400).json({ success: false, error: `bad insightType: ${insightType}` }); return;
      }
      if (!channelId || !channelName) {
        res.status(400).json({ success: false, error: "channelId and channelName required" }); return;
      }
      sanitized.push({
        insightType, channelId, channelName,
        enabled: m?.enabled !== false
      });
    }

    // Replace atomically — delete + createMany inside a transaction.
    await prisma.$transaction([
      prisma.slackChannelMapping.deleteMany({ where: { installationId: install.id } }),
      prisma.slackChannelMapping.createMany({
        data: sanitized.map((m) => ({
          installationId: install.id,
          insightType:    m.insightType,
          channelId:      m.channelId,
          channelName:    m.channelName,
          enabled:        m.enabled
        }))
      })
    ]);

    const rows = await prisma.slackChannelMapping.findMany({
      where: { installationId: install.id },
      orderBy: { createdAt: "asc" }
    });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, insightType: r.insightType, channelId: r.channelId,
        channelName: r.channelName, enabled: r.enabled, createdAt: r.createdAt
      }))
    });
  }),

  // POST /api/integrations/slack/:installationId/test-send
  // Body: { channelId }
  testSend: h(async (req: Request, res: Response): Promise<void> => {
    if (!getSlackConfig()) { notConfigured(res); return; }

    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const install = await loadInstallation(merchantId, String(req.params.installationId));
    if (!install) { res.status(404).json({ success: false, error: "Installation not found." }); return; }

    const channelId = String((req.body as any)?.channelId || "");
    if (!channelId) { res.status(400).json({ success: false, error: "channelId required" }); return; }

    const merchant = await prisma.merchant.findUnique({
      where:  { id: merchantId },
      select: { language: true }
    });
    const locale = pickLocale(merchant?.language);

    const result = await sendSlackTestMessage({
      installationId: install.id, channelId, locale
    });
    if (!result.ok) {
      res.status(502).json({ success: false, error: result.error || "test_send_failed" });
      return;
    }
    res.json({ success: true, data: { ts: result.ts } });
  }),

  // PATCH /api/integrations/slack/preferences
  // Body: { slackEnabled?, slackChannels?: string[] }
  updatePreferences: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Unauthorized" }); return; }

    const body = (req.body || {}) as { slackEnabled?: boolean; slackChannels?: unknown };
    const update: { slackEnabled?: boolean; slackChannels?: string[] } = {};

    if (typeof body.slackEnabled === "boolean") {
      update.slackEnabled = body.slackEnabled;
    }
    if (Array.isArray(body.slackChannels)) {
      const cleaned = (body.slackChannels as unknown[])
        .map((s) => String(s))
        .filter((s) => ALLOWED_SLACK_SEVERITIES.has(s));
      update.slackChannels = cleaned;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ success: false, error: "No valid fields to update." });
      return;
    }

    const row = await prisma.notificationPreference.upsert({
      where:  { merchantId },
      create: { merchantId, ...update },
      update
    });
    res.json({
      success: true,
      data: {
        slackEnabled:  row.slackEnabled,
        slackChannels: row.slackChannels
      }
    });
  })
};
