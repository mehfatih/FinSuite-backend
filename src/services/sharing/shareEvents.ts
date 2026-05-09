// ================================================================
// shareEvents.ts — share status event sink (Sprint D-3 placeholder).
//
// In Sprint D-3 this is a no-op that just logs to stdout. In Sprint
// D-4 (Notifications) this becomes the entry point that:
//   - persists a Notification row for the merchant
//   - pushes a real-time toast to the dashboard via SSE/WebSocket
//   - eventually fires Resend webhook handlers to update
//     deliveredAt/openedAt on the InsightShare row
//
// The shape of `ShareEvent` is the contract D-4 will consume.
// ================================================================

export type ShareEventType =
  | "share.sent"        // share row written successfully
  | "share.failed"      // PDF render OR send failed
  | "share.delivered"   // Resend webhook (D-4)
  | "share.opened"      // Resend webhook (D-4)
  | "share.downloaded"; // public /share/:token recipient tap

export interface ShareEvent {
  type:       ShareEventType;
  shareId:    string;
  merchantId: string;
  channel:    "email" | "whatsapp";
  metadata?:  Record<string, unknown>;
}

/**
 * Emit a share status event. Sprint D-3 logged only; Sprint D-4
 * forwards interesting events into the notification engine. The
 * default `shareEventChannels` is `["inapp"]` so the merchant gets
 * a quiet bell notification when their accountant opens / downloads
 * the share — no email or push by default.
 *
 * Best-effort fan-out — failures are logged but never thrown.
 */
export function emitShareEvent(event: ShareEvent): void {
  console.log(
    `[share.event] ${event.type} share=${event.shareId} merchant=${event.merchantId} channel=${event.channel}`
  );
  // Only "informative" events go to the notification feed. Failures
  // and bare "sent" events stay in the share-history audit log only.
  if (event.type === "share.delivered" || event.type === "share.opened" || event.type === "share.downloaded") {
    void forwardToNotificationEngine(event).catch((err) =>
      console.error("[share.event] notification dispatch failed:", err?.message || err)
    );
  }
}

async function forwardToNotificationEngine(event: ShareEvent): Promise<void> {
  const { dispatch } = await import("../notifications/engine");
  const titles = {
    "share.delivered":  "Paylaşım ulaştı",
    "share.opened":     "Paylaşım açıldı",
    "share.downloaded": "Paylaşım indirildi"
  } as const;
  const bodies = {
    "share.delivered":  "Paylaştığın dosya alıcının kutusuna ulaştı.",
    "share.opened":     "Alıcı paylaştığın brifingi açtı.",
    "share.downloaded": "Alıcı paylaştığın PDF'i indirdi."
  } as const;
  await dispatch({
    merchantId: event.merchantId,
    severity:   "SHARE_EVENT",
    type:       event.type,
    title:      (titles as any)[event.type] || "Paylaşım güncellemesi",
    body:       (bodies as any)[event.type] || "",
    iconTone:   "cyan",
    shareId:    event.shareId,
    data:       { channel: event.channel, ...(event.metadata || {}) }
  });
}
