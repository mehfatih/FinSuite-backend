// ================================================================
// Sprint D-7 — Privacy mode renderer for shared insights.
//
// Four modes (set per-share):
//   full           — values shown as-is
//   masked         — currency + percentages bucketed into bands
//   narrative_only — same as masked + numericRefs cleared
//   anonymous      — same as narrative_only + merchant name redacted
//
// Mask logic:
//   "₺28,500" / "$28k"            → "₺25-50K"
//   "%52" / "52%"                  → "above 50%"
//   numericRefs (KPI snapshot)     → bucketed bands or null
//
// Pure function — input shape, output shape, no side effects. The
// HTML template (publicShareTemplate.ts) consumes this.
// ================================================================

export type PrivacyMode = "full" | "masked" | "narrative_only" | "anonymous";

export interface SourceInsight {
  id:           string;
  type:         string;          // CRITICAL / ATTENTION / OPPORTUNITY
  title:        string;
  body:         string;
  numericRefs:  Record<string, unknown> | null;
  language:     string;
  ctaLabel?:    string | null;
  ctaRoute?:    string | null;
}

export interface RenderedInsight {
  id:           string;
  type:         string;
  title:        string;
  body:         string;
  numericRefs:  Record<string, unknown> | null;
  language:     string;
  ctaLabel:     string | null;
  ctaRoute:     string | null;
  merchantName: string;
  privacyMode:  PrivacyMode;
}

const ANONYMOUS_LABELS = {
  tr: "Bir Zyrix kullanıcısı",
  en: "A Zyrix merchant",
  ar: "تاجر زيريكس"
} as const;

// ─── Currency band ────────────────────────────────────────────

function currencyBand(value: number): string {
  const v = Math.abs(value);
  if (v < 1_000)        return v > 0 ? "<1K" : "0";
  if (v < 10_000)       return "1-10K";
  if (v < 50_000)       return "10-50K";
  if (v < 100_000)      return "50-100K";
  if (v < 500_000)      return "100-500K";
  if (v < 1_000_000)    return "500K-1M";
  if (v < 10_000_000)   return "1-10M";
  if (v < 100_000_000)  return "10-100M";
  return "100M+";
}

function pctBand(value: number): string {
  const v = Math.abs(value);
  if (v < 5)   return "<5%";
  if (v < 10)  return "5-10%";
  if (v < 25)  return "10-25%";
  if (v < 50)  return "25-50%";
  if (v < 75)  return "above 50%";
  return "above 75%";
}

// ─── String masking ───────────────────────────────────────────

const CURRENCY_RE = /([₺$€£﷼]|TRY|USD|EUR|GBP|SAR)\s*([\d.,]+)\s*([KkMm])?/g;
const PCT_RE      = /(\d+(?:[.,]\d+)?)\s*%/g;

function parseNumeric(raw: string, suffix?: string): number {
  // Normalize "28,500" / "28.500" / "28k" / "28K" / "28m"
  const cleaned = raw.replace(/[.,]/g, "").trim();
  let n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  if (suffix && /[Kk]/.test(suffix))      n *= 1_000;
  else if (suffix && /[Mm]/.test(suffix)) n *= 1_000_000;
  return n;
}

function maskBody(body: string): string {
  let out = body.replace(CURRENCY_RE, (_m, sym, num, suf) => {
    const value = parseNumeric(num, suf);
    return `${sym}${currencyBand(value)}`;
  });
  out = out.replace(PCT_RE, (_m, num) => {
    const value = parseNumeric(num);
    return pctBand(value);
  });
  return out;
}

function stripBody(body: string): string {
  // narrative_only: remove every numeric value (currency + pct + bare numbers).
  let out = body.replace(CURRENCY_RE, "—");
  out = out.replace(PCT_RE, "—");
  // Bare standalone numbers >= 4 digits (likely amounts) also masked.
  out = out.replace(/\b\d{4,}\b/g, "—");
  return out;
}

// ─── numericRefs masking ──────────────────────────────────────

function maskNumericRefs(refs: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!refs) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(refs)) {
    if (typeof val === "number") {
      // Heuristic: keys ending in _pct → percent band; everything
      // else (mrr, cash_balance, etc.) → currency band.
      out[key] = key.toLowerCase().endsWith("_pct") ? pctBand(val) : currencyBand(val);
    } else if (val === null || val === undefined) {
      out[key] = null;
    } else if (typeof val === "string" || typeof val === "boolean") {
      out[key] = val;
    } else {
      // nested object/array — drop to be safe
      out[key] = null;
    }
  }
  return out;
}

// ─── Public entry point ───────────────────────────────────────

export function applyPrivacy(args: {
  insight:      SourceInsight;
  mode:         PrivacyMode;
  merchantName: string;
}): RenderedInsight {
  const { insight, mode, merchantName } = args;
  const lang = (insight.language || "tr") as keyof typeof ANONYMOUS_LABELS;

  if (mode === "full") {
    return {
      id:           insight.id,
      type:         insight.type,
      title:        insight.title,
      body:         insight.body,
      numericRefs:  insight.numericRefs ?? null,
      language:     insight.language,
      ctaLabel:     insight.ctaLabel ?? null,
      ctaRoute:     insight.ctaRoute ?? null,
      merchantName,
      privacyMode:  mode
    };
  }

  if (mode === "masked") {
    return {
      id:           insight.id,
      type:         insight.type,
      title:        maskBody(insight.title),
      body:         maskBody(insight.body),
      numericRefs:  maskNumericRefs(insight.numericRefs ?? null),
      language:     insight.language,
      ctaLabel:     insight.ctaLabel ?? null,
      ctaRoute:     null,           // CTAs link back into the app — strip in privacy modes
      merchantName,
      privacyMode:  mode
    };
  }

  if (mode === "narrative_only") {
    return {
      id:           insight.id,
      type:         insight.type,
      title:        stripBody(insight.title),
      body:         stripBody(insight.body),
      numericRefs:  null,
      language:     insight.language,
      ctaLabel:     null,
      ctaRoute:     null,
      merchantName,
      privacyMode:  mode
    };
  }

  // anonymous = narrative_only + redact merchant name
  return {
    id:           insight.id,
    type:         insight.type,
    title:        stripBody(insight.title),
    body:         stripBody(insight.body),
    numericRefs:  null,
    language:     insight.language,
    ctaLabel:     null,
    ctaRoute:     null,
    merchantName: ANONYMOUS_LABELS[lang] || ANONYMOUS_LABELS.tr,
    privacyMode:  mode
  };
}
