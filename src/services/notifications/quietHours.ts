// ================================================================
// quietHours.ts — TZ-aware quiet-hours + mute logic.
//
// Critical events bypass quiet hours and mute by default
// (configurable: per-severity channels matrix can drop "email" /
// "webpush" if the merchant explicitly opts out).
//
// Quiet hours are stored as integers 0-23 in `Merchant.timezone`.
// `quietHoursStart=22, quietHoursEnd=8` means "quiet from 22:00 to
// 08:00 local". When start > end, the range crosses midnight.
// ================================================================
import { prisma } from "../../config/database";
import type { NotificationSeverity } from "./types";

export interface QuietHoursDecision {
  blocked:    boolean;
  reason?:    "muted" | "quiet_hours";
  /** If blocked, the next moment we should retry (engine can defer). */
  resumeAt?:  Date;
}

/** Return current local hour 0-23 in the given IANA tz. */
function localHourIn(tz: string, when: Date = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hour12: false, timeZone: tz
    });
    const parts = fmt.formatToParts(when);
    const h = parts.find((p) => p.type === "hour")?.value ?? "0";
    return parseInt(h, 10) % 24;
  } catch {
    return when.getUTCHours();   // fallback if tz invalid
  }
}

function isWithinQuietHours(start: number, end: number, hour: number): boolean {
  if (start === end) return false;            // 0-length range → no quiet hours
  if (start < end)   return hour >= start && hour < end;
  // Range crosses midnight (e.g. 22 → 8): quiet if hour >= start OR hour < end.
  return hour >= start || hour < end;
}

/** Compute the next "active" Date when a deferred event should fire. */
function nextActiveAt(tz: string, end: number, when: Date = new Date()): Date {
  try {
    // We compute "today" in the merchant's tz, set the hour to `end`, then
    // if that's already past, jump to tomorrow.
    const nowParts = new Intl.DateTimeFormat("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", hour12: false, timeZone: tz
    }).formatToParts(when);
    const y  = parseInt(nowParts.find((p) => p.type === "year")?.value  || "1970", 10);
    const m  = parseInt(nowParts.find((p) => p.type === "month")?.value || "1",    10);
    const d  = parseInt(nowParts.find((p) => p.type === "day")?.value   || "1",    10);
    const hh = parseInt(nowParts.find((p) => p.type === "hour")?.value  || "0",    10);
    const candidate = new Date(Date.UTC(y, m - 1, d, end, 0, 0, 0));
    // Adjust UTC offset by computing the offset between provided tz and UTC at this moment.
    const offsetMs = (when.getTime() - new Date(Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(when)).getTime()) || 0;
    const local = new Date(candidate.getTime() - offsetMs);
    if (hh >= end) {
      local.setUTCDate(local.getUTCDate() + 1);
    }
    return local;
  } catch {
    return new Date(when.getTime() + 60 * 60 * 1000);
  }
}

export async function evaluateQuietHours(args: {
  merchantId: string;
  severity:   NotificationSeverity;
}): Promise<QuietHoursDecision> {
  // Critical bypasses everything.
  if (args.severity === "CRITICAL") return { blocked: false };

  const [prefs, merchant] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { merchantId: args.merchantId } }),
    prisma.merchant.findUnique({ where: { id: args.merchantId }, select: { timezone: true } })
  ]);

  // Mute kill-switch.
  if (prefs?.mutedUntil && new Date(prefs.mutedUntil) > new Date()) {
    return { blocked: true, reason: "muted", resumeAt: new Date(prefs.mutedUntil) };
  }

  const start = prefs?.quietHoursStart;
  const end   = prefs?.quietHoursEnd;
  if (start == null || end == null) return { blocked: false };

  const tz = merchant?.timezone || "Europe/Istanbul";
  const hour = localHourIn(tz);
  if (!isWithinQuietHours(start, end, hour)) return { blocked: false };

  return { blocked: true, reason: "quiet_hours", resumeAt: nextActiveAt(tz, end) };
}
