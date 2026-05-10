// ================================================================
// Sprint D-5 — Morning brief scheduler.
//
// Pure module: no Express, no Resend. Exposed for both the cron
// endpoint and unit tests.
//
// Tick model:
//   The cron runs every 15 min. A subscription "fires" when the
//   merchant's local hour now equals sendHourLocal AND no send
//   has happened in the last 23 hours. The 23-hour guard prevents
//   double-fire on the next 15-min tick that still falls inside
//   the same local hour.
//
// Frequency rules (Merchant.timezone is the local frame of reference):
//   - 'never'    → never fires
//   - 'daily'    → fires every day at sendHourLocal
//   - 'weekdays' → fires Mon-Fri only (skips local Sat/Sun)
//   - 'weekly'   → fires only when local day-of-week == weeklyDay
//                  (0=Sunday..6=Saturday; matches Date.getDay())
//
// All time math is done by formatting `now` into the merchant's tz
// via native `Intl.DateTimeFormat` — no `date-fns-tz` dep.
// ================================================================
import { prisma } from "../../config/database";
import { localPartsIn } from "./tz";
import { sendMorningBrief } from "./sendBrief";

const DOUBLE_FIRE_GUARD_MS = 23 * 60 * 60 * 1000;

export type Frequency = "daily" | "weekdays" | "weekly" | "never";

export interface ScheduleSubscription {
  id:             string;
  merchantId:     string;
  enabled:        boolean;
  frequency:      string;
  weeklyDay:      number | null;
  sendHourLocal:  number;
  lastSentAt:     Date | null;
  bounceCount:    number;
  variant:        string;
}

export interface ScheduleMerchant {
  id:        string;
  timezone:  string;
  email:     string;
  language:  string;
  name:      string;
  businessName: string | null;
}

export interface TickResult {
  scannedAt:  string;
  candidates: number;
  sent:       number;
  skipped:    number;
  failed:     number;
  details:    Array<{
    merchantId: string;
    outcome:    "sent" | "skipped" | "failed";
    reason?:    string;
    sendId?:    string;
  }>;
}

/**
 * Decide whether a single subscription should fire on this tick.
 * Pure function — exported for testability.
 */
export function shouldSendNow(args: {
  sub:       Pick<ScheduleSubscription, "frequency" | "weeklyDay" | "sendHourLocal" | "lastSentAt" | "enabled">;
  localHour: number;
  localDow:  number;     // 0=Sunday..6=Saturday
  nowMs:     number;
}): { fire: boolean; reason?: string } {
  const { sub, localHour, localDow, nowMs } = args;

  if (!sub.enabled)                         return { fire: false, reason: "disabled" };
  if (sub.frequency === "never")            return { fire: false, reason: "frequency=never" };
  if (sub.sendHourLocal !== localHour)      return { fire: false, reason: `local_hour_mismatch (${localHour}!=${sub.sendHourLocal})` };

  if (sub.frequency === "weekdays" && (localDow === 0 || localDow === 6)) {
    return { fire: false, reason: "weekend_skip" };
  }
  if (sub.frequency === "weekly") {
    if (sub.weeklyDay == null)              return { fire: false, reason: "weekly_no_day" };
    if (sub.weeklyDay !== localDow)         return { fire: false, reason: `weekly_dow_mismatch (${localDow}!=${sub.weeklyDay})` };
  }

  if (sub.lastSentAt && nowMs - sub.lastSentAt.getTime() < DOUBLE_FIRE_GUARD_MS) {
    return { fire: false, reason: "double_fire_guard" };
  }

  return { fire: true };
}

/** Fetch all enabled subscriptions joined with their merchant. */
export async function findEnabledSubscriptions(): Promise<Array<{ sub: ScheduleSubscription; merchant: ScheduleMerchant }>> {
  const rows = await prisma.morningBriefSubscription.findMany({
    where:   { enabled: true },
    include: {
      merchant: {
        select: {
          id: true, timezone: true, email: true, language: true,
          name: true, businessName: true
        }
      }
    }
  });
  return rows.map((r) => ({
    sub: {
      id: r.id, merchantId: r.merchantId, enabled: r.enabled,
      frequency: r.frequency, weeklyDay: r.weeklyDay,
      sendHourLocal: r.sendHourLocal, lastSentAt: r.lastSentAt,
      bounceCount: r.bounceCount, variant: r.variant
    },
    merchant: {
      id: r.merchant.id, timezone: r.merchant.timezone, email: r.merchant.email,
      language: r.merchant.language as unknown as string,
      name: r.merchant.name,
      businessName: r.merchant.businessName ?? null
    }
  }));
}

/**
 * Main entry point. Loops every enabled subscription, fires the ones
 * whose local hour matches, throttles 200ms between sends to mirror
 * the existing cronController pattern.
 */
export async function runMorningBriefTick(nowArg?: Date): Promise<TickResult> {
  const now    = nowArg || new Date();
  const nowMs  = now.getTime();
  const result: TickResult = {
    scannedAt:  now.toISOString(),
    candidates: 0,
    sent:       0,
    skipped:    0,
    failed:     0,
    details:    []
  };

  let pairs: Array<{ sub: ScheduleSubscription; merchant: ScheduleMerchant }>;
  try {
    pairs = await findEnabledSubscriptions();
  } catch (err: any) {
    console.error("[morning-brief/tick] findEnabledSubscriptions failed:", err?.message || err);
    return result;
  }

  result.candidates = pairs.length;

  for (const { sub, merchant } of pairs) {
    let parts: { hour: number; dayOfWeek: number };
    try {
      parts = localPartsIn(merchant.timezone, now);
    } catch {
      result.skipped++;
      result.details.push({ merchantId: merchant.id, outcome: "skipped", reason: "bad_timezone" });
      continue;
    }

    const decision = shouldSendNow({
      sub,
      localHour: parts.hour,
      localDow:  parts.dayOfWeek,
      nowMs
    });
    if (!decision.fire) {
      result.skipped++;
      result.details.push({ merchantId: merchant.id, outcome: "skipped", reason: decision.reason });
      continue;
    }

    try {
      const send = await sendMorningBrief({ sub, merchant });
      if (send.ok) {
        await prisma.morningBriefSubscription.update({
          where: { id: sub.id },
          data:  { lastSentAt: now }
        }).catch((err) => console.error(`[morning-brief/tick] lastSentAt update failed for ${sub.id}:`, err?.message || err));
        result.sent++;
        result.details.push({ merchantId: merchant.id, outcome: "sent", sendId: send.sendId });
      } else {
        result.failed++;
        result.details.push({ merchantId: merchant.id, outcome: "failed", reason: send.reason });
      }
    } catch (err: any) {
      result.failed++;
      result.details.push({ merchantId: merchant.id, outcome: "failed", reason: err?.message || String(err) });
      console.error(`[morning-brief/tick] sendMorningBrief threw for ${merchant.id}:`, err?.message || err);
    }

    // Throttle to avoid Resend rate-limit; matches existing cronController.
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
}
