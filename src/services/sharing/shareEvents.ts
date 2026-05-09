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
 * Emit a share status event. Sprint D-3: log only. D-4 will wire
 * this into the notification engine (subscriber pattern), without
 * any controller-side change required.
 */
export function emitShareEvent(event: ShareEvent): void {
  // Logging keeps the audit trail visible in Railway logs in the
  // meantime, and lets us prove the wiring is correct end-to-end.
  console.log(
    `[share.event] ${event.type} share=${event.shareId} merchant=${event.merchantId} channel=${event.channel}`
  );
}
