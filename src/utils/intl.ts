// ================================================================
// Sprint D-11 — Intl helpers (zero deps).
//
// Per discovery decision §10.K: locked to Intl.NumberFormat +
// Intl.DateTimeFormat — no dayjs/numbro/luxon. These wrappers
// give callers a consistent API while keeping the underlying
// browser-native API one function call away when needed.
//
// Used by: invoice PDF templates, ZATCA QR encoder, slack
// slashCommandRouter, morning-brief / weekly-report email
// templates, admin AI usage dashboard.
// ================================================================

export interface FormatMoneyArgs {
  amount:    number | string | null | undefined;
  currency:  string;                   // ISO 4217: 'TRY' | 'SAR' | 'USD' | …
  locale?:   string;                   // BCP-47: 'tr-TR' | 'ar-SA' | 'en-US'
  /** When true, returns "₺ 12,500" (symbol + space + number); else "12.500,00 ₺". */
  symbolFirst?: boolean;
  /** Decimal precision; default 0 for TRY/SAR (B2B prefers no fractions). */
  fractionDigits?: number;
}

/**
 * Format a money amount per locale + currency.
 *
 * Intl.NumberFormat handles symbol placement and separators correctly
 * for tr-TR / ar-SA / en-US — we never have to reach for the manual
 * `decimal: ',' / thousands: '.'` config from CountryProfile.intl.
 */
export function formatMoney(args: FormatMoneyArgs): string {
  const n = typeof args.amount === "number" ? args.amount : Number(args.amount ?? 0);
  if (!Number.isFinite(n)) return "—";
  const locale = args.locale || "en-US";
  const fractionDigits = args.fractionDigits ?? 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: args.currency || "USD",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(n);
  } catch {
    // Unknown currency code → bare number with locale grouping.
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(n) + " " + (args.currency || "");
  }
}

export interface FormatDateArgs {
  date:    Date | string | number | null | undefined;
  locale?: string;
  /** Style preset; defaults to "medium" (e.g. "10 May 2026" / "10/05/2026"). */
  style?:  "short" | "medium" | "long" | "full";
  /** Override display (e.g. "{day}/{month}/{year}"); leave undefined for locale default. */
  format?: { year?: "numeric" | "2-digit"; month?: "numeric" | "2-digit" | "short" | "long"; day?: "numeric" | "2-digit" };
}

export function formatDate(args: FormatDateArgs): string {
  if (args.date === null || args.date === undefined) return "—";
  const d = args.date instanceof Date ? args.date : new Date(args.date);
  if (Number.isNaN(d.getTime())) return "—";
  const locale = args.locale || "en-US";
  try {
    if (args.format) {
      return new Intl.DateTimeFormat(locale, args.format).format(d);
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: args.style || "medium" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Format a plain number (no currency) per locale grouping. Used for
 * line counts, percentages, etc.
 */
export function formatNumber(n: number | string | null | undefined, locale: string = "en-US", fractionDigits: number = 0): string {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(v);
  } catch {
    return String(v);
  }
}

/**
 * Format a percentage (0.20 → "20 %"). Optional fractionDigits.
 */
export function formatPercent(value: number | string | null | undefined, locale: string = "en-US", fractionDigits: number = 0): string {
  const v = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(v);
  } catch {
    return `${(v * 100).toFixed(fractionDigits)}%`;
  }
}
