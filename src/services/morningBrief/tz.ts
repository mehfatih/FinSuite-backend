// ================================================================
// Sprint D-5 — Tiny TZ helper.
//
// Mirrors the pattern in services/notifications/quietHours.ts but
// returns hour AND day-of-week in one call (the scheduler needs
// both per tick). No date-fns-tz dep — native Intl.DateTimeFormat.
// ================================================================

const DOW_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
};

/**
 * Return local hour (0-23) and day-of-week (0=Sun..6=Sat) in `tz`.
 * Throws on an invalid tz so the scheduler can skip and log.
 */
export function localPartsIn(tz: string, when: Date = new Date()): {
  hour:      number;
  dayOfWeek: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour:    "numeric",
    hour12:  false,
    weekday: "short",
    timeZone: tz
  });
  const parts = fmt.formatToParts(when);
  const hourStr    = parts.find((p) => p.type === "hour")?.value;
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value;
  if (hourStr == null || weekdayStr == null) {
    throw new Error(`tz_parse_failed: ${tz}`);
  }
  const hour      = parseInt(hourStr, 10) % 24;
  const dayOfWeek = DOW_MAP[weekdayStr] ?? -1;
  if (dayOfWeek < 0) throw new Error(`tz_weekday_unknown: ${weekdayStr}`);
  return { hour, dayOfWeek };
}
