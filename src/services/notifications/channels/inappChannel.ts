// ================================================================
// channels/inappChannel.ts — in-app notification driver.
// Persists a Notification row and broadcasts to any active SSE
// subscribers for the merchant. The persisted row is what powers
// the bell badge + dropdown + archive page.
//
// The legacy NotificationType enum (INFO/WARNING/SUCCESS/ERROR) is
// preserved on the row for compatibility with the 8 controllers
// already writing to this table; the new D-4 fields (severity /
// iconTone / ctaLabel / ctaRoute / channelsSent / insightId /
// shareId) are populated additively.
// ================================================================
import { prisma } from "../../../config/database";
import { broadcast } from "../sseHub";
import type {
  ChannelDriver,
  ChannelResult,
  NotificationEvent,
  PersistedNotification,
  NotificationSeverity
} from "../types";

const SEVERITY_TO_LEGACY: Record<NotificationSeverity, "INFO" | "WARNING" | "SUCCESS" | "ERROR"> = {
  CRITICAL:    "ERROR",
  ATTENTION:   "WARNING",
  OPPORTUNITY: "SUCCESS",
  SHARE_EVENT: "INFO",
  SYSTEM:      "INFO"
};

const SEVERITY_TO_TONE: Record<NotificationSeverity, "cyan" | "violet" | "mint" | "amber" | "crimson"> = {
  CRITICAL:    "crimson",
  ATTENTION:   "amber",
  OPPORTUNITY: "mint",
  SHARE_EVENT: "cyan",
  SYSTEM:      "violet"
};

/**
 * Persist + broadcast an in-app notification.
 * Returns the persisted row so other channels can reference it.
 */
export async function persistInApp(event: NotificationEvent): Promise<PersistedNotification> {
  const tone = event.iconTone || SEVERITY_TO_TONE[event.severity];
  const legacyType = SEVERITY_TO_LEGACY[event.severity];

  const row = await prisma.notification.create({
    data: {
      merchantId:   event.merchantId,
      title:        event.title.slice(0, 200),
      body:         event.body.slice(0, 1000),
      message:      event.body.slice(0, 200),  // legacy field — short summary
      type:         legacyType,
      severity:     event.severity,
      iconTone:     tone,
      ctaLabel:     event.ctaLabel || null,
      ctaRoute:     event.ctaRoute || null,
      insightId:    event.insightId || null,
      shareId:      event.shareId  || null,
      channelsSent: ["inapp"],
      data:         event.data ? (event.data as any) : null
    }
  });

  const persisted: PersistedNotification = {
    id:           row.id,
    merchantId:   row.merchantId,
    severity:     (row.severity as NotificationSeverity | null),
    type:         event.type,
    title:        row.title,
    body:         row.body || "",
    iconTone:     row.iconTone as any,
    ctaLabel:     row.ctaLabel,
    ctaRoute:     row.ctaRoute,
    insightId:    row.insightId,
    shareId:      row.shareId,
    data:         (row.data as any) || null,
    channelsSent: row.channelsSent as any,
    isRead:       row.isRead,
    archived:     row.archived,
    createdAt:    row.createdAt
  };

  // Fan out to any active SSE subscribers for this merchant.
  broadcast(event.merchantId, "notification", persisted);

  return persisted;
}

export const inappChannel: ChannelDriver = {
  channel: "inapp",
  async send({ event }): Promise<ChannelResult> {
    try {
      const row = await persistInApp(event);
      return { channel: "inapp", success: true, refId: row.id };
    } catch (err: any) {
      return { channel: "inapp", success: false, error: err?.message || String(err) };
    }
  }
};
