// ================================================================
// routing.ts — given a NotificationEvent + the merchant's
// NotificationPreference row, decide which channels to dispatch.
//
// Defaults (when the merchant has no row yet) come from the
// NotificationPreference column defaults in the schema:
//   critical   → inapp + email + webpush
//   attention  → inapp + email
//   opportunity→ inapp
//   shareEvent → inapp
// ================================================================
import { prisma } from "../../config/database";
import type { NotificationChannel, NotificationEvent, NotificationSeverity } from "./types";

const DEFAULT_CHANNELS: Record<NotificationSeverity, NotificationChannel[]> = {
  CRITICAL:    ["inapp", "email", "webpush"],
  ATTENTION:   ["inapp", "email"],
  OPPORTUNITY: ["inapp"],
  SHARE_EVENT: ["inapp"],
  SYSTEM:      ["inapp"]
};

/** Decide which channels to fire for this event + merchant. */
export async function selectChannels(event: NotificationEvent): Promise<NotificationChannel[]> {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { merchantId: event.merchantId }
  });

  const requested = pickChannelsForSeverity(event.severity, prefs);

  // Apply master per-channel toggles.
  return requested.filter((ch) => isChannelEnabled(ch, prefs, event.severity));
}

function pickChannelsForSeverity(
  severity: NotificationSeverity,
  prefs: any
): NotificationChannel[] {
  if (!prefs) return DEFAULT_CHANNELS[severity];
  switch (severity) {
    case "CRITICAL":    return (prefs.criticalChannels    as NotificationChannel[]) || DEFAULT_CHANNELS.CRITICAL;
    case "ATTENTION":   return (prefs.attentionChannels   as NotificationChannel[]) || DEFAULT_CHANNELS.ATTENTION;
    case "OPPORTUNITY": return (prefs.opportunityChannels as NotificationChannel[]) || DEFAULT_CHANNELS.OPPORTUNITY;
    case "SHARE_EVENT": return (prefs.shareEventChannels  as NotificationChannel[]) || DEFAULT_CHANNELS.SHARE_EVENT;
    case "SYSTEM":      return DEFAULT_CHANNELS.SYSTEM;
  }
}

function isChannelEnabled(
  channel: NotificationChannel,
  prefs: any,
  severity: NotificationSeverity
): boolean {
  if (!prefs) return true;   // defaults — all channels enabled
  if (channel === "inapp"    && prefs.inappEnabled    === false) return false;
  if (channel === "email"    && prefs.emailEnabled    === false) return false;
  if (channel === "webpush"  && prefs.webPushEnabled  === false) return false;
  if (channel === "mobilepush" && prefs.mobilePushEnabled === false) return false;
  return true;
}

/** Read prefs (or defaults) — used by quiet-hours / batching logic. */
export async function loadPreferences(merchantId: string) {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { merchantId }
  });
  return {
    inappEnabled:        prefs?.inappEnabled        ?? true,
    emailEnabled:        prefs?.emailEnabled        ?? true,
    webPushEnabled:      prefs?.webPushEnabled      ?? false,
    mobilePushEnabled:   prefs?.mobilePushEnabled   ?? false,
    digestFrequency:     (prefs?.digestFrequency as "instant" | "hourly" | "daily" | "never") || "instant",
    quietHoursStart:     prefs?.quietHoursStart     ?? null,
    quietHoursEnd:       prefs?.quietHoursEnd       ?? null,
    mutedUntil:          prefs?.mutedUntil          ?? null
  };
}
