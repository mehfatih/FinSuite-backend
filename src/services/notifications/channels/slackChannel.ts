// ================================================================
// Sprint D-9 — Slack channel driver for the notification engine.
//
// Plugs into the D-4 ChannelDriver interface (services/notifications/
// types.ts). Server-side flow per dispatch:
//
//   1. configureSlackChannel() guards on getSlackConfig() — returns
//      false when SLACK_* env vars are missing, so register-time
//      registration is a no-op. Server boot is unaffected.
//   2. send() looks up active SlackInstallations for the merchant,
//      then SlackChannelMappings whose insightType matches event.severity
//      OR the wildcard 'all'. Disabled mappings filtered out.
//   3. For each (installation, channelId) pair: idempotency lookup
//      against SlackOutboundLog; if already posted ok, skip. Then
//      per-channel debounce gap (1 sec). Then chat.postMessage.
//   4. Persist a SlackOutboundLog row for the audit trail.
//
// Error handling: rate limits get one Retry-After honour + retry;
// auth_revoked / not_in_channel marked in errorCode for the admin
// dashboard. We never throw — engine.ts logs the ChannelResult.
// ================================================================
import { prisma } from "../../../config/database";
import { decrypt } from "../../../utils/encryption";
import { getSlackConfig, isSlackConfigured } from "../../integrations/slack/config";
import { postMessage, SlackApiError } from "../../integrations/slack/client";
import {
  renderInsightAsBlocks,
  renderTestMessageAsBlocks,
  Locale,
  InsightForSlack
} from "../../integrations/slack/blockRenderer";
import type { ChannelDriver, ChannelResult, NotificationEvent } from "../types";

const APP_BASE_URL = (process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co").replace(/\/$/, "");
const PER_CHANNEL_GAP_MS = 1000;

// ─── In-memory rate-limit gap (decision §10.J option J1) ─────
// Promote to Redis when we run multiple Express instances; until
// then a Map is enough for V1 (Railway runs a single process).
const lastPostByChannel = new Map<string, number>();

async function applyDebounce(installationId: string, channelId: string): Promise<void> {
  const key  = `${installationId}:${channelId}`;
  const last = lastPostByChannel.get(key) || 0;
  const now  = Date.now();
  const wait = PER_CHANNEL_GAP_MS - (now - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastPostByChannel.set(key, Date.now());
}

function pickLocaleFromMerchant(language: string | null | undefined): Locale {
  const lang = String(language || "").toUpperCase();
  if (lang === "EN") return "en";
  if (lang === "AR") return "ar";
  return "tr";
}

export function configureSlackChannel(): boolean {
  const ok = isSlackConfigured();
  if (!ok) {
    console.warn("[slackChannel] SLACK_* env vars missing; channel disabled.");
  } else {
    console.log("[slackChannel] configured.");
  }
  return ok;
}

// ─── Insight loader (used when event.insightId is set) ───────

async function loadInsightForEvent(event: NotificationEvent): Promise<InsightForSlack | null> {
  if (!event.insightId) return null;
  const row = await prisma.insight.findFirst({
    where: { id: event.insightId, merchantId: event.merchantId }
  });
  if (!row) return null;
  return {
    id:           row.id,
    type:         row.type as "CRITICAL" | "ATTENTION" | "OPPORTUNITY",
    title:        row.title,
    body:         row.body,
    ctaLabel:     row.ctaLabel,
    ctaRoute:     row.ctaRoute,
    numericRefs:  row.numericRefs as unknown,
    generatedAt:  row.generatedAt
  };
}

function buildSyntheticInsight(event: NotificationEvent): InsightForSlack {
  // Non-insight events (share.opened etc.) don't have an Insight row.
  // We render them with the generic shape so the Block Kit renderer
  // can produce a valid card without branching.
  const fallbackType: "CRITICAL" | "ATTENTION" | "OPPORTUNITY" =
    event.severity === "CRITICAL"  ? "CRITICAL"  :
    event.severity === "ATTENTION" ? "ATTENTION" :
                                     "OPPORTUNITY";
  return {
    id:        event.shareId || `evt_${Date.now()}`,
    type:      fallbackType,
    title:     event.title,
    body:      event.body,
    ctaLabel:  event.ctaLabel,
    ctaRoute:  event.ctaRoute,
    generatedAt: new Date()
  };
}

// ─── Driver ──────────────────────────────────────────────────

export const slackChannel: ChannelDriver = {
  channel: "slack",

  async send({ event }): Promise<ChannelResult> {
    if (!getSlackConfig()) {
      return { channel: "slack", success: false, error: "slack_not_configured" };
    }

    // 1. Active installations for this merchant.
    const installations = await prisma.slackInstallation.findMany({
      where:   { merchantId: event.merchantId, uninstalledAt: null },
      include: {
        channelMappings: {
          where: { enabled: true }
        },
        merchant: { select: { language: true } }
      }
    });
    if (installations.length === 0) {
      return { channel: "slack", success: false, error: "no_installation" };
    }

    // 2. Build insight payload once (independent of channel/installation).
    const insight = (await loadInsightForEvent(event)) || buildSyntheticInsight(event);
    const locale  = pickLocaleFromMerchant(installations[0]?.merchant?.language);
    const { text, blocks } = renderInsightAsBlocks({ insight, locale, appBaseUrl: APP_BASE_URL });

    // 3. Fan out per-installation, per-mapping, with idempotency guard.
    let sent = 0;
    let lastError: string | undefined;

    for (const install of installations) {
      const matching = install.channelMappings.filter((m) =>
        m.insightType === event.severity || m.insightType === "all"
      );
      if (matching.length === 0) continue;

      // Decrypt once per installation (cheap; tokens are short).
      let botToken: string;
      try {
        botToken = decrypt(install.botToken);
      } catch (err: any) {
        lastError = `decrypt_failed:${err?.message || "unknown"}`;
        continue;
      }

      for (const mapping of matching) {
        // Idempotency — never double-post the same insight to the same
        // channel. ok=true rows guard against re-fired events.
        if (event.insightId) {
          const existing = await prisma.slackOutboundLog.findFirst({
            where: {
              installationId: install.id,
              channelId:      mapping.channelId,
              insightId:      event.insightId,
              ok:             true
            },
            select: { id: true }
          });
          if (existing) {
            sent++;          // count as success — already delivered
            continue;
          }
        }

        await applyDebounce(install.id, mapping.channelId);

        try {
          const result = await postMessage({
            botToken,
            channel: mapping.channelId,
            text,
            blocks
          });
          await prisma.slackOutboundLog.create({
            data: {
              installationId: install.id,
              insightId:      event.insightId || null,
              channelId:      mapping.channelId,
              slackTs:        result.ts,
              ok:             true
            }
          }).catch((err) => console.error("[slackChannel] log create failed:", err?.message || err));
          sent++;
        } catch (err) {
          let errorCode = "unknown";
          let raw       = "";
          if (err instanceof SlackApiError) {
            errorCode = err.slackError;
            raw       = err.message;
            // Tolerate: bot kicked, channel archived, token revoked.
            // The next channel-validation cron (deferred per Mehmet's
            // note) will mark these mappings disabled.
          } else if (err instanceof Error) {
            raw = err.message;
          }
          lastError = errorCode;
          await prisma.slackOutboundLog.create({
            data: {
              installationId: install.id,
              insightId:      event.insightId || null,
              channelId:      mapping.channelId,
              ok:             false,
              errorCode,
              rawError:       raw.slice(0, 500)
            }
          }).catch((logErr) => console.error("[slackChannel] log create failed:", logErr?.message || logErr));
        }
      }
    }

    if (sent === 0) {
      return { channel: "slack", success: false, error: lastError || "no_mapping_matched" };
    }
    return { channel: "slack", success: true, refId: String(sent) };
  }
};

// ─── Test-send helper for the channel-mapping UI's test button ───

export async function sendSlackTestMessage(args: {
  installationId: string;
  channelId:      string;
  locale:         Locale;
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  if (!getSlackConfig()) return { ok: false, error: "slack_not_configured" };

  const install = await prisma.slackInstallation.findUnique({
    where: { id: args.installationId }
  });
  if (!install || install.uninstalledAt) return { ok: false, error: "no_installation" };

  let botToken: string;
  try { botToken = decrypt(install.botToken); }
  catch { return { ok: false, error: "decrypt_failed" }; }

  const { text, blocks } = renderTestMessageAsBlocks({ locale: args.locale, workspaceName: install.workspaceName });

  try {
    const result = await postMessage({ botToken, channel: args.channelId, text, blocks });
    await prisma.slackOutboundLog.create({
      data: {
        installationId: install.id,
        channelId:      args.channelId,
        slackTs:        result.ts,
        ok:             true
      }
    }).catch(() => undefined);
    return { ok: true, ts: result.ts };
  } catch (err) {
    const code = err instanceof SlackApiError ? err.slackError : "unknown";
    await prisma.slackOutboundLog.create({
      data: {
        installationId: install.id,
        channelId:      args.channelId,
        ok:             false,
        errorCode:      code
      }
    }).catch(() => undefined);
    return { ok: false, error: code };
  }
}
