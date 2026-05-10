// ================================================================
// Sprint D-5 — Cinematic morning-brief email template.
//
// Pure-CSS gradient mesh header (per decision 6.C — no @vercel/og,
// no node-canvas). Inline styles only. Three locales (tr/en/ar)
// with dir="rtl" + IBM Plex Sans Arabic for Arabic. Pre-header
// text is set via a hidden div per the hard rule. Final HTML stays
// well under the 100 KB cap (typical render: ~12-18 KB).
//
// Visual chrome borrows from services/sharing/shareEmailTemplate.ts
// (D-3), kept inline rather than extracted to keep the renderer
// self-contained and the diff readable.
// ================================================================
import type { GeneratedBrief, GeneratedCard, CardSeverity } from "./generator";

type Locale = "tr" | "en" | "ar";

const STR = {
  appName:    { tr: "Zyrix FinSuite",    en: "Zyrix FinSuite",     ar: "زيريكس فينسوت" },
  copilot:    { tr: "AI Co-Pilot",       en: "AI Co-Pilot",        ar: "المساعد الذكي" },
  greeting:   { tr: "Günaydın",          en: "Good morning",        ar: "صباح الخير" },
  briefTag:   { tr: "Sabah Brifingi",     en: "Morning Brief",       ar: "إيجاز الصباح" },
  todays:     { tr: "Bugün için",         en: "Today",               ar: "لليوم" },
  severities: {
    CRITICAL:    { tr: "KRİTİK", en: "CRITICAL",    ar: "حرج" },
    ATTENTION:   { tr: "DİKKAT", en: "ATTENTION",   ar: "تنبيه" },
    OPPORTUNITY: { tr: "FIRSAT", en: "OPPORTUNITY", ar: "فرصة" }
  },
  kpiHeader:  { tr: "KPI Özeti",          en: "KPI Snapshot",        ar: "ملخص المؤشرات" },
  kpiNoData:  { tr: "—",                   en: "—",                    ar: "—" },
  cta:        { tr: "Panele git",          en: "Open dashboard",      ar: "افتح اللوحة" },
  ctaSecondary: { tr: "Tüm içgörüler",     en: "All insights",        ar: "كل الرؤى" },
  poweredBy:  { tr: "Zyrix Sabah Brifingi her gün belirlediğin saatte gelir.",
                en: "Zyrix Morning Brief lands at the time you choose, every day.",
                ar: "إيجاز زيريكس الصباحي يصل في الوقت الذي تحدده كل يوم." },
  prefs:      { tr: "Tercihleri yönet",    en: "Manage preferences",  ar: "إدارة التفضيلات" },
  unsub:      { tr: "Aboneliği iptal et",  en: "Unsubscribe",         ar: "إلغاء الاشتراك" }
} as const;

const KPI_LABEL: Record<string, Record<Locale, string>> = {
  mrr:                  { tr: "MRR",                 en: "MRR",                 ar: "الإيرادات الشهرية" },
  cash_balance:         { tr: "Hazır nakit",         en: "Cash balance",         ar: "الرصيد النقدي" },
  customer_health_pct:  { tr: "Müşteri sağlığı",      en: "Customer health",     ar: "صحة العملاء" },
  tax_burden:           { tr: "Vergi yükü",            en: "Tax burden",          ar: "العبء الضريبي" },
  cash_runway_days:     { tr: "Nakit ömrü",            en: "Cash runway",         ar: "عمر النقد" },
  overdue_receivables:  { tr: "Gecikmiş alacak",       en: "Overdue receivables", ar: "ذمم متأخرة" }
};

const T = (key: keyof typeof STR, locale: Locale): string => {
  const v = (STR as any)[key];
  if (v && typeof v === "object" && "tr" in v) return v[locale] || v.tr;
  return String(key);
};

const SEV_TONE: Record<CardSeverity, { color: string; bg: string; border: string }> = {
  CRITICAL:    { color: "#FF3D5A", bg: "rgba(255, 61, 90, 0.10)",  border: "rgba(255, 61, 90, 0.36)"  },
  ATTENTION:   { color: "#FFB800", bg: "rgba(255, 184, 0, 0.10)",  border: "rgba(255, 184, 0, 0.36)"  },
  OPPORTUNITY: { color: "#06A87E", bg: "rgba(6, 168, 126, 0.10)",  border: "rgba(6, 168, 126, 0.36)"  }
};

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtCurrency(n: number | null, currency: string, locale: Locale): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return T("kpiNoData", locale);
  const sym = currency === "TRY" ? "₺" : currency === "USD" ? "$" : currency === "SAR" ? "﷼ " : "";
  return `${sym}${Math.round(n).toLocaleString(locale === "tr" ? "tr-TR" : locale === "ar" ? "ar-EG" : "en-US")}`;
}

function fmtPct(n: number | null, locale: Locale): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return T("kpiNoData", locale);
  return `${n.toFixed(0)}%`;
}

function fmtDays(n: number | null, locale: Locale): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return T("kpiNoData", locale);
  const d = Math.round(n);
  return locale === "tr" ? `${d} gün` : locale === "ar" ? `${d} يوم` : `${d}d`;
}

function kpiCell(args: { label: string; value: string; tone: string }): string {
  return `
    <td valign="top" style="padding:14px 16px; background:#F8FAFF; border:1px solid rgba(15,23,42,0.06); border-radius:12px; width:50%;">
      <div style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${args.tone};">${esc(args.label)}</div>
      <div style="margin-top:6px; font-size:18px; font-weight:800; color:#0F172A; letter-spacing:-0.01em;">${esc(args.value)}</div>
    </td>`;
}

function cardBlock(card: GeneratedCard, locale: Locale, dashboardUrl: string): string {
  const tone = SEV_TONE[card.severity];
  const badge = T("severities", locale)
    ? (STR.severities[card.severity] as any)[locale] || (STR.severities[card.severity] as any).tr
    : card.severity;
  const ctaLabel = card.ctaLabel || T("cta", locale);
  const ctaHref  = card.ctaRoute ? `${dashboardUrl}${card.ctaRoute.startsWith("/") ? "" : "/"}${card.ctaRoute}` : dashboardUrl;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
      <tr>
        <td style="padding:18px 20px; background:#FFFFFF; border:1px solid ${tone.border}; border-${locale === "ar" ? "right" : "left"}:4px solid ${tone.color}; border-radius:14px;">
          <div style="display:inline-block; padding:3px 10px; background:${tone.bg}; border:1px solid ${tone.border}; border-radius:999px; color:${tone.color}; font-size:10px; font-weight:800; letter-spacing:0.10em; text-transform:uppercase;">
            ${esc(badge)}
          </div>
          <div style="margin-top:10px; font-size:17px; font-weight:700; color:#0F172A; line-height:1.30; letter-spacing:-0.01em;">
            ${esc(card.title)}
          </div>
          <div style="margin-top:8px; font-size:14px; line-height:1.55; color:#334155;">
            ${esc(card.description)}
          </div>
          <div style="margin-top:14px;">
            <a href="${esc(ctaHref)}" style="display:inline-block; padding:9px 18px; background:${tone.color}; color:#FFFFFF; text-decoration:none; border-radius:10px; font-size:12px; font-weight:700; letter-spacing:0.04em;">
              ${esc(ctaLabel)} →
            </a>
          </div>
        </td>
      </tr>
    </table>`;
}

export interface RenderArgs {
  brief:        GeneratedBrief;
  unsubUrl:     string;        // signed JWT URL from unsubscribeToken.ts
  dashboardUrl?: string;       // defaults to https://finsuite.zyrix.co
  prefsUrl?:    string;        // defaults to dashboardUrl + /settings/notifications
}

export function renderMorningBriefHtml(args: RenderArgs): string {
  const { brief, unsubUrl } = args;
  const locale     = brief.language;
  const dir        = locale === "ar" ? "rtl" : "ltr";
  const align      = locale === "ar" ? "right" : "left";
  const fontStack  = locale === "ar"
    ? "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif"
    : "'Inter', 'Segoe UI', system-ui, sans-serif";

  const dashboardUrl = (args.dashboardUrl || "https://finsuite.zyrix.co").replace(/\/$/, "");
  const prefsUrl     = args.prefsUrl     || `${dashboardUrl}/settings/notifications`;

  const greeting = `${T("greeting", locale)}${brief.merchantName ? `, ${esc(brief.merchantName)}` : ""}`;
  const briefDateLocal = brief.briefDate; // already YYYY-MM-DD in merchant tz

  const cards = brief.cards.length > 0
    ? brief.cards.map((c) => cardBlock(c, locale, dashboardUrl)).join("")
    : "";

  // Pick 4 KPIs for the 2x2 grid; fall through gracefully if any are null.
  const k = brief.kpis;
  const kpiRow1 = `
    <tr>
      ${kpiCell({ label: KPI_LABEL.mrr[locale],                value: fmtCurrency(k.mrr ?? null, brief.currency, locale),                tone: "#9D4EDD" })}
      <td style="width:8px;"></td>
      ${kpiCell({ label: KPI_LABEL.cash_balance[locale],       value: fmtCurrency(k.cash_balance ?? null, brief.currency, locale),       tone: "#00D9FF" })}
    </tr>`;
  const kpiRow2 = `
    <tr><td colspan="3" style="height:8px;"></td></tr>
    <tr>
      ${kpiCell({ label: KPI_LABEL.customer_health_pct[locale], value: fmtPct(k.customer_health_pct ?? null, locale),                    tone: "#06A87E" })}
      <td style="width:8px;"></td>
      ${kpiCell({ label: KPI_LABEL.tax_burden[locale],          value: fmtCurrency(k.tax_burden ?? null, brief.currency, locale),         tone: "#FFB800" })}
    </tr>`;

  return `<!DOCTYPE html>
<html lang="${esc(locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(brief.subject)}</title>
</head>
<body style="margin:0; padding:0; background:#F0F4FF; font-family:${fontStack}; -webkit-font-smoothing:antialiased;">

  <!-- PRE-HEADER (hidden but populates inbox preview) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0F4FF;">
    ${esc(brief.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F4FF;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#FFFFFF; border-radius:18px; overflow:hidden; box-shadow:0 4px 32px rgba(15,23,42,0.08); text-align:${align};">

          <!-- HEADER (cinematic gradient mesh — pure CSS, degrades to solid in Outlook) -->
          <tr>
            <td style="padding:32px 36px 28px; background:radial-gradient(ellipse 70% 60% at 25% 25%, rgba(157,78,221,0.85), transparent 60%), radial-gradient(ellipse 70% 60% at 75% 65%, rgba(0,217,255,0.85), transparent 60%), linear-gradient(135deg, #0A0E27 0%, #131838 100%);">
              <div style="display:inline-block; padding:6px 12px; background:rgba(0,217,255,0.12); border:1px solid rgba(0,217,255,0.40); border-radius:999px; color:#5DFAFF; font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase;">
                ${esc(T("appName", locale))} · ${esc(T("briefTag", locale))}
              </div>
              <h1 style="margin:18px 0 6px; color:#F8FAFC; font-size:24px; font-weight:800; letter-spacing:-0.02em; line-height:1.20;">
                ${greeting}
              </h1>
              <div style="color:#CBD5E1; font-size:13px; letter-spacing:0.02em;">
                ${esc(briefDateLocal)} · ${esc(T("todays", locale))}
              </div>
            </td>
          </tr>

          <!-- CARDS -->
          <tr>
            <td style="padding:24px 28px 12px;">
              ${cards}
            </td>
          </tr>

          <!-- KPI 2x2 GRID -->
          <tr>
            <td style="padding:8px 28px 8px;">
              <div style="font-size:11px; font-weight:800; letter-spacing:0.10em; text-transform:uppercase; color:#64748B; margin-bottom:10px;">
                ${esc(T("kpiHeader", locale))}
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${kpiRow1}
                ${kpiRow2}
              </table>
            </td>
          </tr>

          <!-- SECONDARY CTA -->
          <tr>
            <td style="padding:24px 28px 8px; text-align:center;">
              <a href="${esc(dashboardUrl)}" style="display:inline-block; padding:13px 30px; background:linear-gradient(135deg,#9D4EDD 0%, #00D9FF 100%); color:#FFFFFF; text-decoration:none; border-radius:12px; font-size:13px; font-weight:800; letter-spacing:0.04em; box-shadow:0 4px 18px rgba(157,78,221,0.30);">
                ${esc(T("cta", locale))} →
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:22px 28px; background:#F8FAFF; border-top:1px solid rgba(15,23,42,0.06); text-align:center;">
              <p style="margin:0 0 8px; color:#475569; font-size:12px; line-height:1.55;">
                ${esc(T("poweredBy", locale))}
              </p>
              <p style="margin:0; font-size:11px; color:#94A3B8;">
                <a href="${esc(prefsUrl)}" style="color:#9D4EDD; text-decoration:none; font-weight:700;">${esc(T("prefs", locale))}</a>
                <span style="color:#CBD5E1;"> &nbsp;·&nbsp; </span>
                <a href="${esc(unsubUrl)}" style="color:#94A3B8; text-decoration:underline;">${esc(T("unsub", locale))}</a>
              </p>
              <p style="margin:8px 0 0; font-size:10px; color:#CBD5E1;">
                <a href="${esc(dashboardUrl)}" style="color:#94A3B8; text-decoration:none;">finsuite.zyrix.co</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text fallback (Resend auto-generates if absent, but a deliberate
 *  one improves deliverability and Outlook plain-text-only previews). */
export function renderMorningBriefText(brief: GeneratedBrief): string {
  const lines: string[] = [];
  lines.push(`${brief.subject}`);
  lines.push("");
  lines.push(brief.preheader);
  lines.push("");
  for (const c of brief.cards) {
    lines.push(`[${c.severity}] ${c.title}`);
    lines.push(c.description);
    if (c.ctaLabel) lines.push(`→ ${c.ctaLabel}`);
    lines.push("");
  }
  lines.push("--");
  lines.push("Zyrix FinSuite — finsuite.zyrix.co");
  return lines.join("\n");
}
