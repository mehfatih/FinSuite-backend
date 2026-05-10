// ================================================================
// Sprint D-6 — Cinematic weekly report email template.
//
// Decision §6.E option E2: dedicated template (mirrors the D-5
// morning-brief layout) rather than extending the D-3 share email.
// Self-contained, easier to evolve independently.
//
// Email payload:
//   - Pre-header text (hidden div) for inbox preview
//   - Cinematic gradient mesh header + Zyrix tag
//   - Greeting + week range
//   - Narrative excerpt (first 220 chars)
//   - 4 KPI mini-cards in 2x2 grid (MRR / Net Cash / Margin / Runway)
//     each with the WoW delta indicator
//   - Primary CTA "Open report" → /reports/weekly/:reportId
//   - Footer with Manage preferences + Unsubscribe links
//
// PDF rides as a Resend base64 attachment (same as D-3 share path).
// ================================================================
import type { WeeklySnapshot } from "./weeklyKpis";

export type Locale = "tr" | "en" | "ar";

const STR = {
  appName:    { tr: "Zyrix FinSuite",        en: "Zyrix FinSuite",         ar: "زيريكس فينسوت" },
  copilot:    { tr: "AI Co-Pilot",           en: "AI Co-Pilot",            ar: "المساعد الذكي" },
  weeklyTag:  { tr: "Haftalık Performans",   en: "Weekly Performance",     ar: "الأداء الأسبوعي" },
  greeting:   { tr: "Merhaba",                en: "Hello",                  ar: "مرحبًا" },
  ctaOpen:    { tr: "Raporu aç",              en: "Open report",            ar: "افتح التقرير" },
  pdfNote:    { tr: "Tam PDF rapor ekte.",     en: "Full PDF report attached.", ar: "تقرير PDF الكامل مرفق." },
  prefs:      { tr: "Tercihleri yönet",        en: "Manage preferences",     ar: "إدارة التفضيلات" },
  unsub:      { tr: "Aboneliği iptal et",      en: "Unsubscribe",            ar: "إلغاء الاشتراك" },
  preheader:  { tr: "Haftalık performans raporun hazır.", en: "Your weekly performance report is ready.", ar: "تقرير أدائك الأسبوعي جاهز." },
  poweredBy:  { tr: "Zyrix Haftalık Performans her pazar 18:00'de gelir.",
                en: "Zyrix Weekly Performance arrives every Sunday at 18:00.",
                ar: "أداء زيريكس الأسبوعي يصل كل أحد في الساعة 18:00." },

  // KPI labels
  mrr:        { tr: "MRR",                   en: "MRR",                    ar: "الإيرادات الشهرية" },
  netCash:    { tr: "Net Nakit",              en: "Net Cash",               ar: "صافي النقد" },
  margin:     { tr: "Brüt Marj",              en: "Gross Margin",           ar: "الهامش الإجمالي" },
  runway:     { tr: "Nakit Ömrü",             en: "Cash Runway",            ar: "عمر النقد" },

  // Subject line
  subjectDefault: { tr: "Haftalık Performans Raporun Hazır", en: "Your Weekly Performance Report is Ready", ar: "تقرير أدائك الأسبوعي جاهز" }
} as const;

const T = (key: keyof typeof STR, locale: Locale): string => {
  const v: any = STR[key];
  return v?.[locale] || v?.tr || String(key);
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

function fmtCurrency(n: number, currency: string, locale: Locale): string {
  if (!Number.isFinite(n)) return "—";
  const sym = currency === "TRY" ? "₺" : currency === "USD" ? "$" : currency === "SAR" ? "﷼ " : "";
  const lc  = locale === "tr" ? "tr-TR" : locale === "ar" ? "ar-EG" : "en-US";
  return `${sym}${Math.round(n).toLocaleString(lc)}`;
}

function deltaPill(deltaPct: number, locale: Locale): string {
  if (!Number.isFinite(deltaPct) || Math.abs(deltaPct) < 0.1) {
    return `<span style="font-size:10px; color:#94A3B8; font-weight:600;">±0%</span>`;
  }
  const up    = deltaPct >= 0;
  const color = up ? "#06A87E" : "#FF3D5A";
  const arrow = up ? "↑" : "↓";
  return `<span style="font-size:10px; color:${color}; font-weight:700;">${arrow} ${Math.abs(deltaPct).toFixed(1)}%</span>`;
}

function kpiCell(args: { label: string; value: string; tone: string; delta: string }): string {
  return `
    <td valign="top" style="padding:12px 14px; background:#F8FAFF; border:1px solid rgba(15,23,42,0.06); border-radius:10px; width:50%;">
      <div style="font-size:10px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${args.tone};">${args.label}</div>
      <div style="margin-top:4px; font-size:17px; font-weight:800; color:#0F172A; letter-spacing:-0.01em;">${args.value}</div>
      <div style="margin-top:2px;">${args.delta}</div>
    </td>`;
}

export interface RenderArgs {
  snapshot:     WeeklySnapshot;
  merchantName: string;
  reportId:     string;
  unsubUrl:     string;
  language:     Locale;
  appBaseUrl?:  string;     // defaults to https://finsuite.zyrix.co
  prefsUrl?:    string;
}

export function buildSubject(args: { snapshot: WeeklySnapshot; language: Locale }): string {
  const base = T("subjectDefault", args.language);
  const range = `${args.snapshot.weekStart}–${args.snapshot.weekEnd}`;
  const subj  = `${base} · ${range}`;
  return subj.length > 50 ? subj.slice(0, 47) + "…" : subj;
}

export function renderWeeklyReportEmailHtml(args: RenderArgs): string {
  const { snapshot, merchantName, reportId, unsubUrl, language } = args;
  const dir       = language === "ar" ? "rtl" : "ltr";
  const align     = language === "ar" ? "right" : "left";
  const fontStack = language === "ar"
    ? "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif"
    : "'Inter', 'Segoe UI', system-ui, sans-serif";

  const appBase  = (args.appBaseUrl || "https://finsuite.zyrix.co").replace(/\/$/, "");
  const prefsUrl = args.prefsUrl    || `${appBase}/settings/notifications`;
  const reportUrl = `${appBase}/reports/weekly/${encodeURIComponent(reportId)}`;
  const greeting = `${T("greeting", language)}${merchantName ? `, ${esc(merchantName)}` : ""}`;

  const k = snapshot.kpis;
  const cur = snapshot.currency;

  const narrativeShort = snapshot.merchantNew
    ? ""
    : "";  // The full narrative is in the PDF; we keep the email minimal & action-oriented.

  return `<!DOCTYPE html>
<html lang="${esc(language)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(buildSubject({ snapshot, language }))}</title>
</head>
<body style="margin:0; padding:0; background:#F0F4FF; font-family:${fontStack}; -webkit-font-smoothing:antialiased;">

  <!-- PRE-HEADER -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#F0F4FF;">
    ${esc(T("preheader", language))}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F4FF;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px; background:#FFFFFF; border-radius:18px; overflow:hidden;
                      box-shadow:0 4px 32px rgba(15,23,42,0.08); text-align:${align};">

          <!-- HEADER -->
          <tr>
            <td style="padding:32px 36px 28px;
                       background:radial-gradient(ellipse 70% 60% at 25% 25%, rgba(157,78,221,0.85), transparent 60%),
                                  radial-gradient(ellipse 70% 60% at 75% 65%, rgba(0,217,255,0.85), transparent 60%),
                                  linear-gradient(135deg, #0A0E27 0%, #131838 100%);">
              <div style="display:inline-block; padding:6px 12px;
                          background:rgba(0,217,255,0.12);
                          border:1px solid rgba(0,217,255,0.40);
                          border-radius:999px; color:#5DFAFF;
                          font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase;">
                ${esc(T("appName", language))} · ${esc(T("weeklyTag", language))}
              </div>
              <h1 style="margin:18px 0 6px; color:#F8FAFC; font-size:24px; font-weight:800;
                         letter-spacing:-0.02em; line-height:1.20;">
                ${greeting}
              </h1>
              <div style="color:#CBD5E1; font-size:13px; letter-spacing:0.02em;">
                ${esc(snapshot.weekStart)} — ${esc(snapshot.weekEnd)}
              </div>
            </td>
          </tr>

          <!-- 2x2 KPI grid -->
          <tr>
            <td style="padding:24px 28px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${kpiCell({
                    label: T("mrr", language),
                    value: fmtCurrency(k.mrr.value, cur, language),
                    tone:  "#9D4EDD",
                    delta: deltaPill(k.mrr.deltaPct, language)
                  })}
                  <td style="width:8px;"></td>
                  ${kpiCell({
                    label: T("netCash", language),
                    value: fmtCurrency(k.netCash.value, cur, language),
                    tone:  "#00D9FF",
                    delta: deltaPill(k.netCash.deltaPct, language)
                  })}
                </tr>
                <tr><td colspan="3" style="height:8px;"></td></tr>
                <tr>
                  ${kpiCell({
                    label: T("margin", language),
                    value: `${k.margin.value.toFixed(1)}%`,
                    tone:  "#06A87E",
                    delta: deltaPill(k.margin.deltaPct, language)
                  })}
                  <td style="width:8px;"></td>
                  ${kpiCell({
                    label: T("runway", language),
                    value: `${Math.round(k.runway.value)}d`,
                    tone:  "#FFB800",
                    delta: deltaPill(k.runway.deltaPct, language)
                  })}
                </tr>
              </table>
            </td>
          </tr>

          <!-- PDF NOTE + CTA -->
          <tr>
            <td style="padding:18px 28px 28px; text-align:center;">
              <p style="margin:0 0 14px; color:#475569; font-size:13px; line-height:1.55;">
                ${esc(T("pdfNote", language))}
              </p>
              <a href="${esc(reportUrl)}"
                 style="display:inline-block; padding:13px 30px;
                        background:linear-gradient(135deg,#9D4EDD 0%, #00D9FF 100%);
                        color:#FFFFFF; text-decoration:none; border-radius:12px;
                        font-size:13px; font-weight:800; letter-spacing:0.04em;
                        box-shadow:0 4px 18px rgba(157,78,221,0.30);">
                ${esc(T("ctaOpen", language))} →
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:22px 28px; background:#F8FAFF; border-top:1px solid rgba(15,23,42,0.06); text-align:center;">
              <p style="margin:0 0 8px; color:#475569; font-size:12px; line-height:1.55;">
                ${esc(T("poweredBy", language))}
              </p>
              <p style="margin:0; font-size:11px; color:#94A3B8;">
                <a href="${esc(prefsUrl)}" style="color:#9D4EDD; text-decoration:none; font-weight:700;">${esc(T("prefs", language))}</a>
                <span style="color:#CBD5E1;"> &nbsp;·&nbsp; </span>
                <a href="${esc(unsubUrl)}" style="color:#94A3B8; text-decoration:underline;">${esc(T("unsub", language))}</a>
              </p>
              <p style="margin:8px 0 0; font-size:10px; color:#CBD5E1;">
                <a href="${esc(appBase)}" style="color:#94A3B8; text-decoration:none;">finsuite.zyrix.co</a>
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

export function renderWeeklyReportEmailText(args: { snapshot: WeeklySnapshot; merchantName: string; language: Locale; reportUrl: string }): string {
  const { snapshot, merchantName, language, reportUrl } = args;
  const k = snapshot.kpis;
  const cur = snapshot.currency;
  const lines: string[] = [];
  lines.push(`${T("appName", language)} — ${T("weeklyTag", language)}`);
  lines.push("");
  lines.push(`${T("greeting", language)}, ${merchantName}`);
  lines.push(`${snapshot.weekStart} — ${snapshot.weekEnd}`);
  lines.push("");
  lines.push(`${T("mrr", language)}:     ${fmtCurrency(k.mrr.value,     cur, language)} (${k.mrr.deltaPct.toFixed(1)}%)`);
  lines.push(`${T("netCash", language)}: ${fmtCurrency(k.netCash.value, cur, language)} (${k.netCash.deltaPct.toFixed(1)}%)`);
  lines.push(`${T("margin", language)}:  ${k.margin.value.toFixed(1)}% (${k.margin.deltaPct.toFixed(1)}%)`);
  lines.push(`${T("runway", language)}:  ${Math.round(k.runway.value)}d`);
  lines.push("");
  lines.push(`${T("pdfNote", language)}`);
  lines.push(`${T("ctaOpen", language)}: ${reportUrl}`);
  lines.push("");
  lines.push("--");
  lines.push("Zyrix FinSuite — finsuite.zyrix.co");
  return lines.join("\n");
}
