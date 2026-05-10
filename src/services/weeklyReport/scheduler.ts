// ================================================================
// Sprint D-6 — Weekly report scheduler.
//
// Tick model (mirrors D-5):
//   - cron-job.org POSTs every 15 min to /api/cron/weekly-report-tick
//   - For each enabled WeeklyReportSubscription:
//       fires when localDow === sendDayLocal AND localHour ===
//       sendHourLocal AND no send within the last 6 days (guard
//       prevents double-fire on the next 15-min tick).
//
// Defaults: sendDayLocal=0 (Sunday), sendHourLocal=18.
// All time math via native Intl.DateTimeFormat — no date-fns-tz dep.
// ================================================================
import { prisma } from "../../config/database";
import { localPartsIn } from "../morningBrief/tz";
import { sendWeeklyReport } from "./sendWeeklyReport";

const DOUBLE_FIRE_GUARD_MS = 6 * 24 * 60 * 60 * 1000;   // 6 days — allow weekly cadence

export interface WeeklyScheduleSubscription {
  id:             string;
  merchantId:     string;
  enabled:        boolean;
  sendDayLocal:   number;
  sendHourLocal:  number;
  lastSentAt:     Date | null;
  pausedUntil:    Date | null;
  bounceCount:    number;
}

export interface WeeklyScheduleMerchant {
  id:           string;
  timezone:     string;
  email:        string;
  language:     string;
  name:         string;
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
    reportId?:  string;
    sendId?:    string;
  }>;
}

export function shouldSendNow(args: {
  sub:       Pick<WeeklyScheduleSubscription, "enabled" | "pausedUntil" | "sendDayLocal" | "sendHourLocal" | "lastSentAt">;
  localHour: number;
  localDow:  number;     // 0=Sunday..6=Saturday
  nowMs:     number;
}): { fire: boolean; reason?: string } {
  const { sub, localHour, localDow, nowMs } = args;

  if (!sub.enabled) return { fire: false, reason: "disabled" };
  if (sub.pausedUntil && sub.pausedUntil.getTime() > nowMs) {
    return { fire: false, reason: "paused" };
  }
  if (sub.sendDayLocal !== localDow)  return { fire: false, reason: `local_dow_mismatch (${localDow}!=${sub.sendDayLocal})` };
  if (sub.sendHourLocal !== localHour) return { fire: false, reason: `local_hour_mismatch (${localHour}!=${sub.sendHourLocal})` };
  if (sub.lastSentAt && nowMs - sub.lastSentAt.getTime() < DOUBLE_FIRE_GUARD_MS) {
    return { fire: false, reason: "double_fire_guard" };
  }
  return { fire: true };
}

/**
 * Compute the [weekStart, weekEnd) window in the merchant's local
 * frame. weekStart is the local Monday 00:00 of the ISO week
 * containing `now`; weekEnd is the next Monday 00:00 (exclusive).
 * Both are returned as UTC Date objects representing wallclock
 * midnight of the local date — small ±tz-offset skew at boundaries
 * is acceptable for weekly aggregation (decision §6.A trade-off).
 */
export function computeWeekBounds(tz: string, now: Date = new Date()): { weekStart: Date; weekEnd: Date } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
    weekday:  "short"
  });
  const parts   = fmt.formatToParts(now);
  const yearStr = parts.find((p) => p.type === "year")?.value  || "1970";
  const monStr  = parts.find((p) => p.type === "month")?.value || "01";
  const dayStr  = parts.find((p) => p.type === "day")?.value   || "01";
  const wdStr   = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[wdStr] ?? 0;
  // Monday-anchored offset (Mon=0, Tue=1, ..., Sun=6).
  const wfm = (dow + 6) % 7;

  const todayLocal = Date.UTC(parseInt(yearStr, 10), parseInt(monStr, 10) - 1, parseInt(dayStr, 10));
  const weekStart  = new Date(todayLocal - wfm * 24 * 60 * 60 * 1000);
  const weekEnd    = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { weekStart, weekEnd };
}

/** Fetch all enabled subscriptions joined with their merchant. */
export async function findEnabledSubscriptions(): Promise<Array<{ sub: WeeklyScheduleSubscription; merchant: WeeklyScheduleMerchant }>> {
  const rows = await prisma.weeklyReportSubscription.findMany({
    where:   { enabled: true },
    include: {
      merchant: {
        select: { id: true, timezone: true, email: true, language: true, name: true, businessName: true }
      }
    }
  });
  return rows.map((r) => ({
    sub: {
      id:           r.id,
      merchantId:   r.merchantId,
      enabled:      r.enabled,
      sendDayLocal: r.sendDayLocal,
      sendHourLocal: r.sendHourLocal,
      lastSentAt:   r.lastSentAt,
      pausedUntil:  r.pausedUntil,
      bounceCount:  r.bounceCount
    },
    merchant: {
      id:           r.merchant.id,
      timezone:     r.merchant.timezone,
      email:        r.merchant.email,
      language:     String(r.merchant.language || "TR"),
      name:         r.merchant.name,
      businessName: r.merchant.businessName ?? null
    }
  }));
}

export async function runWeeklyReportTick(nowArg?: Date): Promise<TickResult> {
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

  let pairs;
  try {
    pairs = await findEnabledSubscriptions();
  } catch (err: any) {
    console.error("[weeklyReport/tick] findEnabledSubscriptions failed:", err?.message || err);
    return result;
  }

  result.candidates = pairs.length;

  for (const { sub, merchant } of pairs) {
    let parts;
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

    const { weekStart, weekEnd } = computeWeekBounds(merchant.timezone, now);
    const language = (merchant.language || "TR").toLowerCase() as "tr" | "en" | "ar";

    try {
      const send = await sendWeeklyReport({
        merchantId: merchant.id,
        weekStart,
        weekEnd,
        language
      });
      if (send.ok) {
        await prisma.weeklyReportSubscription.update({
          where: { id: sub.id },
          data:  { lastSentAt: now }
        }).catch((err) => console.error(`[weeklyReport/tick] lastSentAt update failed for ${sub.id}:`, err?.message || err));
        result.sent++;
        result.details.push({ merchantId: merchant.id, outcome: "sent", reportId: send.reportId, sendId: send.sendId });
      } else {
        result.failed++;
        result.details.push({ merchantId: merchant.id, outcome: "failed", reason: send.reason });
      }
    } catch (err: any) {
      result.failed++;
      result.details.push({ merchantId: merchant.id, outcome: "failed", reason: err?.message || String(err) });
      console.error(`[weeklyReport/tick] sendWeeklyReport threw for ${merchant.id}:`, err?.message || err);
    }

    // Throttle to avoid Resend rate-limit; matches existing cron pattern.
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
}
