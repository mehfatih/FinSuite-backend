// ================================================================
// engine.ts — notification dispatch entry point.
//
// dispatch(event) →
//   1. Evaluate quiet hours / mute (critical bypasses both).
//   2. Resolve channels from prefs.
//   3. Always run the in-app channel first (persists the row + SSE
//      broadcast). Other channels reference the persisted row.
//   4. Run remaining channels in parallel; collect refIds + errors.
//   5. Update the Notification row with the final channelsSent list.
// ================================================================
import { prisma } from "../../config/database";
import { selectChannels } from "./routing";
import { evaluateQuietHours } from "./quietHours";
import { persistInApp, inappChannel } from "./channels/inappChannel";
import { emailChannel } from "./channels/emailChannel";
import type {
  ChannelDriver, ChannelResult, NotificationChannel,
  NotificationEvent, PersistedNotification
} from "./types";

// Web Push driver is mounted lazily in Step 10 once env vars are
// confirmed live. Until then this map carries inapp + email only.
const driverMap: Partial<Record<NotificationChannel, ChannelDriver>> = {
  inapp: inappChannel,
  email: emailChannel
};

export interface DispatchResult {
  notificationId?: string;
  channels:        ChannelResult[];
  deferredUntil?:  Date;
  reason?:         "muted" | "quiet_hours";
}

export async function dispatch(event: NotificationEvent): Promise<DispatchResult> {
  // 1. Quiet hours / mute
  const qh = await evaluateQuietHours({
    merchantId: event.merchantId,
    severity:   event.severity
  });
  if (qh.blocked) {
    return { channels: [], deferredUntil: qh.resumeAt, reason: qh.reason };
  }

  // 2. Resolve channels
  const channels = await selectChannels(event);

  // 3. In-app first — always persist regardless of selected channels?
  // Decision: only persist if "inapp" is in the selected set. Otherwise
  // we'd write rows the merchant explicitly didn't want; the audit
  // trail (Resend / web-push refIds) lives outside this table.
  let persisted: PersistedNotification | null = null;
  const results: ChannelResult[] = [];

  if (channels.includes("inapp")) {
    persisted = await persistInApp(event);
    results.push({ channel: "inapp", success: true, refId: persisted.id });
  }

  // 4. Remaining channels in parallel.
  const remaining = channels.filter((ch) => ch !== "inapp");
  const fanouts   = await Promise.all(
    remaining.map(async (ch) => {
      const driver = driverMap[ch];
      if (!driver) {
        return { channel: ch, success: false, error: `Channel ${ch} not configured` } as ChannelResult;
      }
      try {
        return await driver.send({ event, notification: persisted });
      } catch (err: any) {
        return { channel: ch, success: false, error: err?.message || String(err) } as ChannelResult;
      }
    })
  );
  results.push(...fanouts);

  // 5. Update channelsSent on the persisted row.
  if (persisted) {
    const sent = results.filter((r) => r.success).map((r) => r.channel);
    if (sent.length !== 1) {  // already has just "inapp"; only update if more
      await prisma.notification.update({
        where: { id: persisted.id },
        data:  { channelsSent: sent }
      }).catch(() => undefined);
    }
  }

  return { notificationId: persisted?.id, channels: results };
}

/** Register a runtime channel driver — used by Step 10 to plug Web Push in. */
export function registerChannel(driver: ChannelDriver): void {
  driverMap[driver.channel] = driver;
}
