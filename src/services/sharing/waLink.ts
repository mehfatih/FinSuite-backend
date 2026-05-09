// ================================================================
// waLink.ts — wa.me deep-link generation for the WhatsApp share path.
// No Meta Cloud API calls; we just build a URL the user taps.
//
// Sprint D-3 takes the wa.me path explicitly (kickoff approval): the
// merchant chooses to share each time, recipient receives a pre-filled
// message + a link to the public /share/:token endpoint that streams
// the PDF.
// ================================================================
import { digits } from "./phone";
import type { Locale } from "../pdf/palette";

type Severity = "critical" | "attention" | "opportunity";
type DocType  = "single_insight" | "daily_brief" | "range_report";

const STR = {
  appLine:    { tr: "Zyrix FinSuite · AI Co-Pilot",    en: "Zyrix FinSuite · AI Co-Pilot",    ar: "زايريكس فينسوت · المساعد الذكي" },
  pdfLabel:   { tr: "PDF",                              en: "PDF",                              ar: "PDF" },
  // Severity badge prefixes
  critical:    { tr: "🔴 KRİTİK",    en: "🔴 CRITICAL",    ar: "🔴 حرج" },
  attention:   { tr: "🟡 DİKKAT",    en: "🟡 ATTENTION",   ar: "🟡 تنبيه" },
  opportunity: { tr: "🟢 FIRSAT",    en: "🟢 OPPORTUNITY", ar: "🟢 فرصة" },
  // Document type labels
  insightLabel:    { tr: "AI İçgörü",       en: "AI Insight",       ar: "رؤية ذكاء اصطناعي" },
  dailyBriefLabel: { tr: "Günlük Brifing",  en: "Daily Brief",      ar: "الإيجاز اليومي" },
  rangeLabel:      { tr: "Performans Raporu", en: "Performance Report", ar: "تقرير الأداء" }
} as const;

const T = (key: keyof typeof STR, locale: Locale): string =>
  STR[key]?.[locale] || STR[key]?.tr || String(key);

export interface BuildWaMessageArgs {
  document: {
    type:      DocType;
    title:     string;
    body?:     string;
    severity?: Severity;
  };
  /** Optional merchant-typed note. */
  customMessage?: string;
  /** Public /share/:token URL — recipient taps to download the PDF. */
  pdfUrl:        string;
  locale:        Locale;
}

/**
 * Build the message body that pre-fills WhatsApp.
 * Compact, properly localized, ends with the PDF link on its own line.
 */
export function buildWaMessage(args: BuildWaMessageArgs): string {
  const { document, customMessage, pdfUrl, locale } = args;
  const lines: string[] = [];

  // 1) Header chip (badge + document type)
  if (document.severity) {
    lines.push(`${T(document.severity, locale)} · ${T(`${docKey(document.type)}` as any, locale)}`);
  } else {
    lines.push(T(`${docKey(document.type)}` as any, locale));
  }

  // 2) Title (bold-ish via WhatsApp markdown *)
  lines.push(`*${document.title}*`);

  // 3) Optional preview body (max 200 chars to keep WA tidy)
  if (document.body) {
    const trimmed = document.body.length > 200 ? document.body.slice(0, 197) + "…" : document.body;
    lines.push("");
    lines.push(trimmed);
  }

  // 4) Optional custom message from the merchant
  if (customMessage) {
    lines.push("");
    lines.push(`> ${customMessage}`);   // WhatsApp blockquote
  }

  // 5) PDF link
  lines.push("");
  lines.push(`📎 ${T("pdfLabel", locale)}: ${pdfUrl}`);

  // 6) Footer signature
  lines.push("");
  lines.push(`— ${T("appLine", locale)}`);

  return lines.join("\n");
}

function docKey(t: DocType): "insightLabel" | "dailyBriefLabel" | "rangeLabel" {
  return t === "single_insight" ? "insightLabel"
       : t === "daily_brief"    ? "dailyBriefLabel"
                                  : "rangeLabel";
}

export interface BuildWaShareLinkArgs extends BuildWaMessageArgs {
  /** Recipient phone in E.164. Optional — when absent, returns wa.me/?text= so user picks contact. */
  phone?: string;
}

export interface BuildWaShareLinkResult {
  /** The wa.me URL ready to redirect to. */
  shareUrl: string;
  /** The pre-filled message text (also embedded in shareUrl). Useful for preview UI. */
  message:  string;
  /** Whether the phone normalization succeeded. False → URL has no phone, user picks contact. */
  hasPhone: boolean;
}

/**
 * Build the wa.me deep-link.
 * If `phone` is supplied and valid E.164, the URL targets that contact.
 * If `phone` is omitted or invalid, we still produce a usable wa.me URL
 * with no contact (recipient picks from their address book on tap).
 */
export function buildWaShareLink(args: BuildWaShareLinkArgs): BuildWaShareLinkResult {
  const message = buildWaMessage(args);
  const text = encodeURIComponent(message);
  const d = args.phone ? digits(args.phone) : null;
  const shareUrl = d
    ? `https://wa.me/${d}?text=${text}`
    : `https://wa.me/?text=${text}`;
  return { shareUrl, message, hasPhone: Boolean(d) };
}
