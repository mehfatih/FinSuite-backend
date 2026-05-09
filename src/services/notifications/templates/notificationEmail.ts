// ================================================================
// notificationEmail.ts — branded HTML for notification emails.
// Three severity variants share one shell:
//   CRITICAL    → crimson glow, urgent feel
//   ATTENTION   → amber glow, informational
//   OPPORTUNITY → mint glow, positive
// Inline strings, no React-Email dep — matches the existing
// emailService.ts + D-3 share email pattern.
// ================================================================

type Locale = "tr" | "ar" | "en";
type Severity = "CRITICAL" | "ATTENTION" | "OPPORTUNITY" | "SHARE_EVENT" | "SYSTEM";

const STR = {
  badge: {
    CRITICAL:    { tr: "KRİTİK",   en: "CRITICAL",    ar: "حرج" },
    ATTENTION:   { tr: "DİKKAT",   en: "ATTENTION",   ar: "تنبيه" },
    OPPORTUNITY: { tr: "FIRSAT",   en: "OPPORTUNITY", ar: "فرصة" },
    SHARE_EVENT: { tr: "BİLDİRİM", en: "NOTIFICATION", ar: "إشعار" },
    SYSTEM:      { tr: "SİSTEM",   en: "SYSTEM",      ar: "النظام" }
  },
  appName:    { tr: "Zyrix FinSuite", en: "Zyrix FinSuite", ar: "زايريكس فينسوت" },
  copilot:    { tr: "AI Co-Pilot",    en: "AI Co-Pilot",    ar: "المساعد الذكي" },
  managePrefs:{ tr: "Bildirim ayarları", en: "Manage notifications", ar: "إعدادات الإشعارات" },
  visit:      { tr: "Panele git",     en: "Open dashboard",  ar: "افتح اللوحة" },
  signature:  { tr: "Zyrix FinSuite — AI Co-Pilot", en: "Zyrix FinSuite — AI Co-Pilot", ar: "زايريكس فينسوت — المساعد الذكي" }
} as const;

const TONE = {
  CRITICAL:    { color: "#FF3D5A", bg: "rgba(255, 61, 90, 0.12)",  border: "rgba(255, 61, 90, 0.45)"  },
  ATTENTION:   { color: "#FFB800", bg: "rgba(255, 184, 0, 0.12)",  border: "rgba(255, 184, 0, 0.45)"  },
  OPPORTUNITY: { color: "#06A87E", bg: "rgba(6, 168, 126, 0.12)",  border: "rgba(6, 168, 126, 0.45)"  },
  SHARE_EVENT: { color: "#00D9FF", bg: "rgba(0, 217, 255, 0.12)",  border: "rgba(0, 217, 255, 0.45)"  },
  SYSTEM:      { color: "#9D4EDD", bg: "rgba(157, 78, 221, 0.12)", border: "rgba(157, 78, 221, 0.45)" }
} as const;

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const T = (k: keyof typeof STR, locale: Locale): string =>
  (STR[k] as any)?.[locale] || (STR[k] as any)?.tr || String(k);

const TBadge = (severity: Severity, locale: Locale): string =>
  STR.badge[severity]?.[locale] || STR.badge[severity]?.tr || String(severity);

export interface NotificationEmailArgs {
  severity:     Severity;
  title:        string;
  body:         string;
  ctaLabel?:    string;
  ctaRoute?:    string;
  merchantName: string;
  locale:       Locale;
}

export function buildNotificationEmail(args: NotificationEmailArgs): string {
  const tone = TONE[args.severity];
  const dir  = args.locale === "ar" ? "rtl" : "ltr";
  const fontStack = args.locale === "ar"
    ? "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif"
    : "'Inter', 'Segoe UI', system-ui, sans-serif";
  const align = args.locale === "ar" ? "right" : "left";

  const ctaUrl = args.ctaRoute
    ? `https://finsuite.zyrix.co${args.ctaRoute}`
    : "https://finsuite.zyrix.co/dashboard";
  const ctaText = args.ctaLabel || T("visit", args.locale);

  return `<!DOCTYPE html>
<html lang="${esc(args.locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(args.title)}</title>
</head>
<body style="margin:0; padding:0; background:#F0F4FF; font-family:${fontStack}; -webkit-font-smoothing:antialiased;">
  <div style="max-width:600px; margin:24px auto; background:#FFFFFF; border-radius:18px; overflow:hidden; box-shadow:0 4px 32px rgba(15, 23, 42, 0.08); text-align:${align};">

    <!-- HEADER -->
    <div style="background:radial-gradient(ellipse 70% 60% at 30% 30%, ${tone.color}55, transparent 60%), linear-gradient(135deg, #0A0E27 0%, #131838 100%); padding:30px 36px 26px; position:relative;">
      <div style="display:inline-flex; align-items:center; gap:8px; padding:5px 12px; background:${tone.bg}; border:1px solid ${tone.border}; border-radius:999px; color:${tone.color}; font-size:10px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase;">
        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${tone.color};"></span>
        ${esc(TBadge(args.severity, args.locale))}
      </div>
      <h1 style="margin:16px 0 0; color:#F8FAFC; font-size:22px; font-weight:700; letter-spacing:-0.02em; line-height:1.25;">
        ${esc(args.title)}
      </h1>
    </div>

    <!-- BODY -->
    <div style="padding:26px 36px;">

      <p style="margin:0 0 16px; color:#475569; font-size:14px; line-height:1.65;">
        ${esc(args.body)}
      </p>

      ${args.merchantName ? `
      <div style="margin-bottom:14px; font-size:11px; color:#94A3B8;">
        ${esc(args.merchantName)}
      </div>` : ``}

      <div style="text-align:center; margin-top:20px;">
        <a href="${esc(ctaUrl)}" style="display:inline-block; background:linear-gradient(135deg, #9D4EDD 0%, #00D9FF 100%); color:#FFFFFF; text-decoration:none; border-radius:12px; padding:12px 26px; font-size:13px; font-weight:700; letter-spacing:0.04em; box-shadow:0 4px 18px rgba(157, 78, 221, 0.30);">
          ${esc(ctaText)} →
        </a>
      </div>
    </div>

    <!-- FOOTER -->
    <div style="background:#F8FAFF; padding:18px 36px; border-top:1px solid rgba(15, 23, 42, 0.06); text-align:center;">
      <p style="margin:0 0 6px; color:#94A3B8; font-size:11px; line-height:1.6;">
        ${esc(T("signature", args.locale))}
      </p>
      <a href="https://finsuite.zyrix.co/settings/notifications" style="color:#9D4EDD; text-decoration:none; font-size:11px; font-weight:600;">
        ${esc(T("managePrefs", args.locale))}
      </a>
    </div>
  </div>
</body>
</html>`;
}
