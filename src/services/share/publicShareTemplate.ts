// ================================================================
// Sprint D-7 — Public share HTML templates.
//
// Decision §6.B option B1: backend Express renders the full HTML
// page (with OG meta tags) for crawlers and humans. Mirrors the
// D-2 PDF template approach (template literals + inline CSS) but
// produces a web page instead of a PDF.
//
// Exports:
//   renderShareHtml         — main share page (cinematic, with comments)
//   renderOgImageHtml       — 1200x630 layout fed to ogImageRenderer
//   renderPasswordGateHtml  — password prompt before unlock
//   renderExpiredHtml       — "this share has expired" cinematic state
//   renderRevokedHtml       — "this share was revoked" state
//   renderNotFoundHtml      — 404 cinematic state
//
// All renders are pure functions returning a complete HTML string.
// Design tokens are hard-coded (matches the email + PDF template
// pattern; design-system-v2 lives only on the frontend SPA).
// ================================================================
import type { RenderedInsight, PrivacyMode } from "./privacyRenderer";

// ─── Color palette (copied from design-system-v2/cinematic/tokens) ──

const PAL = {
  bgDeep:         "#0A0E27",
  bgDeep2:        "#131838",
  pearlWhite:     "#F8FAFC",
  pearlDim:       "#CBD5E1",
  pearlFaint:     "#94A3B8",
  glassBorder:    "rgba(255, 255, 255, 0.10)",
  glassTint:      "rgba(255, 255, 255, 0.04)",
  cyanGlow:       "#5DFAFF",
  cyanCore:       "#00D9FF",
  violet:         "#9D4EDD",
  mint:           "#06FFA5",
  amber:          "#FFB800",
  crimson:        "#FF3D5A"
};

const SEV_TONE: Record<string, { color: string; bg: string; border: string; label: { tr: string; en: string; ar: string } }> = {
  CRITICAL:    { color: PAL.crimson, bg: "rgba(255, 61, 90, 0.10)",  border: "rgba(255, 61, 90, 0.36)",  label: { tr: "KRİTİK", en: "CRITICAL",    ar: "حرج" } },
  ATTENTION:   { color: PAL.amber,   bg: "rgba(255, 184, 0, 0.10)",  border: "rgba(255, 184, 0, 0.36)",  label: { tr: "DİKKAT", en: "ATTENTION",   ar: "تنبيه" } },
  OPPORTUNITY: { color: "#06A87E",   bg: "rgba(6, 168, 126, 0.10)",  border: "rgba(6, 168, 126, 0.36)",  label: { tr: "FIRSAT", en: "OPPORTUNITY", ar: "فرصة" } }
};

type Locale = "tr" | "en" | "ar";

const STR = {
  app:        { tr: "Zyrix FinSuite",       en: "Zyrix FinSuite",        ar: "زيريكس فينسوت" },
  copilot:    { tr: "AI Co-Pilot",          en: "AI Co-Pilot",           ar: "المساعد الذكي" },
  poweredBy:  { tr: "AI Co-Pilot ile",      en: "Powered by AI Co-Pilot", ar: "مدعوم بالمساعد الذكي" },
  sharedBy:   { tr: "Paylaşan:",            en: "Shared by",             ar: "شارك بواسطة" },
  visit:      { tr: "Çalışma alanını ziyaret et", en: "Visit their workspace", ar: "زيارة مساحة عملهم" },
  generatedAt:{ tr: "Oluşturuldu:",         en: "Generated",             ar: "تم إنشاؤه" },
  ctaHook:    { tr: "Bunun gibi bir şey kendi işin için ister misin?",
                en: "Want something like this for your business?",
                ar: "هل تريد شيئًا كهذا لشركتك؟" },
  ctaButton:  { tr: "14 gün ücretsiz dene",  en: "Try Zyrix free for 14 days", ar: "جرّب زيريكس مجانًا 14 يومًا" },
  commentsLabel: { tr: "Yorumlar",          en: "Comments",              ar: "التعليقات" },
  commentBoxPlaceholder: { tr: "Bu içgörü hakkında ne düşünüyorsun?",
                           en: "What do you think about this insight?",
                           ar: "ما رأيك في هذه الرؤية؟" },
  nameLabel:  { tr: "İsim",                 en: "Name",                  ar: "الاسم" },
  emailLabel: { tr: "E-posta (isteğe bağlı)", en: "Email (optional)",    ar: "البريد (اختياري)" },
  emailLabelRequired: { tr: "E-posta", en: "Email", ar: "البريد" },
  postBtn:    { tr: "Gönder",               en: "Post",                  ar: "نشر" },
  posting:    { tr: "Gönderiliyor…",         en: "Posting…",              ar: "جارٍ النشر…" },
  posted:     { tr: "Yorum eklendi",        en: "Comment posted",        ar: "تمت إضافة التعليق" },
  commentError: { tr: "Yorum gönderilemedi.", en: "Could not post comment.", ar: "تعذّر نشر التعليق." },
  commentRateLimited: { tr: "Çok hızlı — biraz bekle.",
                        en: "Too fast — please wait a bit.",
                        ar: "سريع جدًا — انتظر قليلاً." },
  commentEmpty: { tr: "Henüz yorum yok. İlk yazan ol.",
                  en: "No comments yet. Be the first.",
                  ar: "لا توجد تعليقات بعد. كن الأول." },
  reply:      { tr: "Yanıtla",              en: "Reply",                 ar: "رد" },
  cancel:     { tr: "İptal",                en: "Cancel",                ar: "إلغاء" },
  passwordPrompt: { tr: "Bu paylaşım parola korumalı.",
                    en: "This share is password-protected.",
                    ar: "هذا الرابط محمي بكلمة مرور." },
  passwordPlaceholder: { tr: "Parola",      en: "Password",              ar: "كلمة المرور" },
  passwordCta: { tr: "Aç",                  en: "Unlock",                ar: "فتح" },
  passwordError: { tr: "Parola yanlış.",     en: "Incorrect password.",   ar: "كلمة المرور خاطئة." },
  expiredTitle: { tr: "Bu paylaşımın süresi doldu.",
                  en: "This share has expired.",
                  ar: "انتهت صلاحية هذا الرابط." },
  expiredBody:  { tr: "Sahibinden yeni bir bağlantı iste.",
                  en: "Ask the owner for a fresh link.",
                  ar: "اطلب رابطًا جديدًا من المالك." },
  revokedTitle: { tr: "Bu paylaşım iptal edildi.",
                  en: "This share has been revoked.",
                  ar: "تم إلغاء هذا الرابط." },
  notFoundTitle: { tr: "Aradığın şeyi bulamadık.",
                   en: "We couldn't find what you were looking for.",
                   ar: "لم نتمكن من العثور على ما كنت تبحث عنه." },
  notFoundBody: { tr: "Bağlantı yanlış olabilir veya kaldırılmış olabilir.",
                  en: "The link may be incorrect or removed.",
                  ar: "قد يكون الرابط غير صحيح أو تمت إزالته." },
  goHome:       { tr: "Zyrix'e git",        en: "Visit Zyrix",           ar: "زيارة زيريكس" }
} as const;

const T = (key: keyof typeof STR, locale: Locale): string => {
  const v: any = STR[key];
  return v?.[locale] || v?.tr || String(key);
};

// ─── HTML escape ─────────────────────────────────────────────

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function attr(s: unknown): string {
  return esc(s);
}

// JSON-safe escape for inline JS strings.
function jsStr(s: string): string {
  return JSON.stringify(s);
}

function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

function fontStack(locale: Locale): string {
  return locale === "ar"
    ? "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif"
    : "'Inter', 'Segoe UI', system-ui, sans-serif";
}

// ─── Shared chrome CSS ───────────────────────────────────────

function chromeCss(locale: Locale): string {
  return `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: ${PAL.bgDeep};
  color: ${PAL.pearlWhite};
  font-family: ${fontStack(locale)};
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "kern" 1, "liga" 1;
  font-size: 16px;
  line-height: 1.55;
  min-height: 100vh;
}
a { color: ${PAL.cyanCore}; text-decoration: none; }
a:hover { text-decoration: underline; }
button { font-family: inherit; cursor: pointer; }
input, textarea {
  font-family: inherit; color: ${PAL.pearlWhite};
  background: ${PAL.glassTint}; border: 1px solid ${PAL.glassBorder};
  border-radius: 8px; padding: 10px 12px; font-size: 14px;
  outline: none;
}
input:focus, textarea:focus {
  border-color: ${PAL.cyanCore};
  box-shadow: 0 0 0 1px ${PAL.cyanCore}44;
}
.gradient-mesh {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(ellipse 60% 50% at 22% 22%, rgba(157,78,221,0.55), transparent 60%),
    radial-gradient(ellipse 60% 50% at 78% 80%, rgba(0,217,255,0.45), transparent 60%),
    linear-gradient(135deg, ${PAL.bgDeep} 0%, ${PAL.bgDeep2} 100%);
}
.app-bar {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px clamp(16px, 4vw, 32px);
  border-bottom: 1px solid ${PAL.glassBorder};
}
.brand { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; color: ${PAL.pearlWhite}; }
.brand .accent { color: ${PAL.cyanCore}; text-shadow: 0 0 8px ${PAL.cyanCore}66; }
.copilot-tag {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  background: rgba(157,78,221,0.10); border: 1px solid rgba(157,78,221,0.30);
  border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: #C8A2EC;
}
.copilot-tag .dot { width: 6px; height: 6px; border-radius: 50%; background: ${PAL.violet}; box-shadow: 0 0 6px ${PAL.violet}; }
main {
  position: relative; z-index: 1;
  max-width: 720px; margin: 0 auto;
  padding: clamp(24px, 5vw, 48px) clamp(16px, 4vw, 28px) 80px;
}
.glass-card {
  background: ${PAL.glassTint};
  border: 1px solid ${PAL.glassBorder};
  border-radius: 16px;
  backdrop-filter: blur(8px);
}
.center-stage {
  position: relative; z-index: 1;
  min-height: calc(100vh - 70px);
  display: flex; align-items: center; justify-content: center;
  padding: 48px 24px;
}
.center-stage .glass-card { padding: 40px 32px; max-width: 480px; text-align: center; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 28px; border-radius: 12px;
  background: linear-gradient(135deg, ${PAL.violet} 0%, ${PAL.cyanCore} 100%);
  color: #FFFFFF; border: none;
  font-size: 14px; font-weight: 800; letter-spacing: 0.03em;
  box-shadow: 0 6px 20px rgba(157,78,221,0.30);
}
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border-radius: 8px;
  background: transparent; color: ${PAL.pearlDim}; border: 1px solid ${PAL.glassBorder};
  font-size: 12px; font-weight: 700;
}
.field-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.field-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${PAL.pearlFaint};
}
.error-banner {
  margin-top: 12px; padding: 10px 14px;
  background: rgba(255, 61, 90, 0.10); border: 1px solid rgba(255, 61, 90, 0.36);
  color: ${PAL.crimson};
  border-radius: 8px; font-size: 13px;
}
@media (max-width: 600px) {
  main { padding-bottom: 120px; }
}
  `;
}

// ─── Public types ────────────────────────────────────────────

export interface ShareRenderShare {
  slug:          string;
  privacyMode:   PrivacyMode;
  allowComments: boolean;
  requireEmail:  boolean;
  expiresAt:     Date | null;
  generatedAt:   Date;
}

export interface ShareRenderComment {
  id:           string;
  parentId:     string | null;
  authorName:   string;
  authorEmail:  string | null;
  body:         string;
  createdAt:    Date;
  hidden:       boolean;
  replies?:     ShareRenderComment[];
}

export interface ShareRenderArgs {
  share:           ShareRenderShare;
  insight:         RenderedInsight;
  comments:        ShareRenderComment[];
  locale:          Locale;
  appBaseUrl:      string;     // e.g. https://finsuite.zyrix.co
  apiBaseUrl:      string;     // e.g. https://finsuite-backend-production.up.railway.app
  shareBaseUrl:    string;     // e.g. https://finsuite.zyrix.co/s
  signupUrl:       string;     // e.g. https://finsuite.zyrix.co/register?ref=share-{slug}
}

// ─── Main share page render ─────────────────────────────────

export function renderShareHtml(args: ShareRenderArgs): string {
  const { share, insight, comments, locale, appBaseUrl, apiBaseUrl, shareBaseUrl, signupUrl } = args;

  const dir = dirFor(locale);
  const tone = SEV_TONE[insight.type] || SEV_TONE.ATTENTION;
  const sevLabel = tone.label[locale] || tone.label.tr;
  const ogImageUrl = `${apiBaseUrl}/og/share/${encodeURIComponent(share.slug)}.png`;
  const pageUrl    = `${shareBaseUrl}/${encodeURIComponent(share.slug)}`;

  // Description for social previews — first 200 chars of body.
  const desc = insight.body.length > 200 ? insight.body.slice(0, 197) + "…" : insight.body;

  // ── Insight body ──
  const numericRefsBlock = insight.numericRefs && Object.keys(insight.numericRefs).length > 0
    ? renderNumericRefs(insight.numericRefs, tone.color)
    : "";

  // ── Comments ──
  const commentsBlock = share.allowComments
    ? renderCommentsBlock({ comments, share, locale, apiBaseUrl })
    : "";

  return `<!DOCTYPE html>
<html lang="${attr(locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="robots" content="noindex,nofollow" />
<title>${esc(insight.title)} · ${esc(T("app", locale))}</title>

<!-- Open Graph / Twitter / LinkedIn -->
<meta property="og:title"       content="${attr(insight.title)}" />
<meta property="og:description" content="${attr(desc)}" />
<meta property="og:image"       content="${attr(ogImageUrl)}" />
<meta property="og:image:width"  content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url"         content="${attr(pageUrl)}" />
<meta property="og:type"        content="article" />
<meta property="og:site_name"   content="${attr(T("app", locale))}" />
<meta name="twitter:card"        content="summary_large_image" />
<meta name="twitter:title"       content="${attr(insight.title)}" />
<meta name="twitter:description" content="${attr(desc)}" />
<meta name="twitter:image"       content="${attr(ogImageUrl)}" />

<style>${chromeCss(locale)}</style>
</head>
<body>
  <div class="gradient-mesh" aria-hidden="true"></div>

  <header class="app-bar">
    <a href="${attr(appBaseUrl)}" class="brand">Zyrix <span class="accent">FinSuite</span></a>
    <span class="copilot-tag"><span class="dot"></span>${esc(T("poweredBy", locale))}</span>
  </header>

  <main>
    <!-- Hero -->
    <section class="glass-card" style="padding: clamp(24px, 4vw, 36px); margin-bottom: 20px;">
      <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 12px;
                  background:${tone.bg}; border:1px solid ${tone.border}; border-radius:999px;
                  color:${tone.color}; font-size:11px; font-weight:800; letter-spacing:0.10em; text-transform:uppercase;">
        <span style="width:6px; height:6px; border-radius:50%; background:${tone.color}; box-shadow:0 0 6px ${tone.color};"></span>
        ${esc(sevLabel)}
      </div>

      <h1 style="margin: 18px 0 12px; font-size: clamp(24px, 5vw, 34px); font-weight:800; letter-spacing:-0.02em; line-height:1.18; color:${PAL.pearlWhite};">
        ${esc(insight.title)}
      </h1>

      <div style="font-size: 13px; color:${PAL.pearlDim};">
        <strong style="color:${PAL.pearlWhite};">${esc(insight.merchantName)}</strong>
        <span style="margin: 0 8px; opacity: 0.5;">·</span>
        <span>${esc(T("generatedAt", locale))} ${esc(formatDate(share.generatedAt, locale))}</span>
      </div>

      <div style="margin-top: 22px; font-size: 15px; line-height: 1.65; color:${PAL.pearlWhite};">
        ${escMultiline(insight.body)}
      </div>

      ${numericRefsBlock}

      ${insight.ctaLabel && insight.ctaRoute ? `
        <div style="margin-top: 24px;">
          <a href="${attr(appBaseUrl)}${attr(insight.ctaRoute)}" class="btn-primary">
            ${esc(insight.ctaLabel)} →
          </a>
        </div>` : ""}
    </section>

    ${commentsBlock}

    <!-- Marketing CTA -->
    <section style="margin-top: 32px; padding: 28px 24px; text-align: center;
                    background: linear-gradient(135deg, rgba(157,78,221,0.08), rgba(0,217,255,0.06));
                    border: 1px solid rgba(157,78,221,0.20); border-radius: 16px;">
      <div style="font-size: 14px; color:${PAL.pearlDim}; margin-bottom: 14px;">
        ${esc(T("ctaHook", locale))}
      </div>
      <a href="${attr(signupUrl)}" class="btn-primary">${esc(T("ctaButton", locale))} →</a>
      <div style="margin-top: 18px; font-size: 11px; color:${PAL.pearlFaint};">
        ${esc(T("sharedBy", locale))} <strong style="color:${PAL.pearlDim};">${esc(insight.merchantName)}</strong>
      </div>
    </section>
  </main>

  ${share.allowComments ? renderCommentScript({ slug: share.slug, apiBaseUrl, locale, requireEmail: share.requireEmail }) : ""}
</body>
</html>`;
}

// ─── Numeric refs grid ──────────────────────────────────────

function renderNumericRefs(refs: Record<string, unknown>, tone: string): string {
  const entries = Object.entries(refs).filter(([_k, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const tiles = entries.slice(0, 6).map(([k, v]) => `
    <div style="padding: 10px 12px; background: ${PAL.glassTint}; border: 1px solid ${PAL.glassBorder}; border-radius: 10px;">
      <div style="font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${tone};">
        ${esc(humanizeKey(k))}
      </div>
      <div style="margin-top: 4px; font-size: 14px; font-weight: 800; color: ${PAL.pearlWhite}; letter-spacing: -0.01em;">
        ${esc(String(v))}
      </div>
    </div>`).join("");
  return `<div style="margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;">${tiles}</div>`;
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Comments block ─────────────────────────────────────────

function renderCommentsBlock(args: {
  comments: ShareRenderComment[];
  share:    ShareRenderShare;
  locale:   Locale;
  apiBaseUrl: string;
}): string {
  const { comments, share, locale } = args;
  const visible = comments.filter((c) => !c.hidden && !c.parentId);

  const list = visible.length === 0
    ? `<p style="text-align:center; color:${PAL.pearlFaint}; font-size: 13px; padding: 20px 0;">${esc(T("commentEmpty", locale))}</p>`
    : visible.map((c) => renderCommentNode(c, locale)).join("");

  const emailFieldHtml = share.requireEmail
    ? `<div class="field-group">
         <label class="field-label" for="cf-email">${esc(T("emailLabelRequired", locale))}</label>
         <input id="cf-email" name="authorEmail" type="email" required maxlength="120" />
       </div>`
    : `<div class="field-group">
         <label class="field-label" for="cf-email">${esc(T("emailLabel", locale))}</label>
         <input id="cf-email" name="authorEmail" type="email" maxlength="120" />
       </div>`;

  return `
  <section class="glass-card" style="padding: clamp(20px, 4vw, 28px); margin-top: 24px;">
    <h2 style="font-size: 14px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: ${PAL.pearlFaint}; margin-bottom: 14px;">
      ${esc(T("commentsLabel", locale))}
    </h2>

    <div id="comment-list">${list}</div>

    <form id="comment-form" style="margin-top: 20px;" autocomplete="off">
      <!-- HONEYPOT — invisible to humans, bots fill it. -->
      <input type="text" name="website_url" id="cf-honeypot" tabindex="-1" autocomplete="off"
             style="position:absolute; left:-9999px; opacity:0; pointer-events:none;" />

      <div class="field-group">
        <label class="field-label" for="cf-name">${esc(T("nameLabel", locale))}</label>
        <input id="cf-name" name="authorName" type="text" required maxlength="80" />
      </div>

      ${emailFieldHtml}

      <div class="field-group">
        <textarea id="cf-body" name="body" rows="3" required maxlength="2000"
                  placeholder="${attr(T("commentBoxPlaceholder", locale))}"></textarea>
      </div>

      <div id="cf-error" class="error-banner" style="display:none;"></div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
        <button id="cf-submit" class="btn-primary" type="submit">${esc(T("postBtn", locale))}</button>
      </div>
    </form>
  </section>`;
}

function renderCommentNode(c: ShareRenderComment, locale: Locale): string {
  const replies = (c.replies || []).filter((r) => !r.hidden);
  const repliesHtml = replies.map((r) => `
    <div style="margin-top: 10px; padding: 10px 14px; margin-${locale === "ar" ? "right" : "left"}: 16px;
                background: ${PAL.glassTint}; border-${locale === "ar" ? "right" : "left"}: 2px solid ${PAL.violet};
                border-radius: 8px;">
      <div style="font-size: 12px; font-weight: 700; color: ${PAL.pearlWhite};">
        ${esc(r.authorName)}
        <span style="margin-${locale === "ar" ? "right" : "left"}: 6px; color: ${PAL.pearlFaint}; font-weight: 500;">
          ${esc(formatRelative(r.createdAt, locale))}
        </span>
      </div>
      <div style="margin-top: 4px; font-size: 13px; color: ${PAL.pearlDim}; line-height: 1.55;">
        ${escMultiline(r.body)}
      </div>
    </div>`).join("");

  return `
  <article style="padding: 12px 0; border-bottom: 1px solid ${PAL.glassBorder};" data-comment-id="${attr(c.id)}">
    <div style="font-size: 13px; font-weight: 700; color: ${PAL.pearlWhite};">
      ${esc(c.authorName)}
      <span style="margin-${locale === "ar" ? "right" : "left"}: 8px; color: ${PAL.pearlFaint}; font-weight: 500; font-size: 11px;">
        ${esc(formatRelative(c.createdAt, locale))}
      </span>
    </div>
    <div style="margin-top: 6px; font-size: 14px; color: ${PAL.pearlDim}; line-height: 1.6;">
      ${escMultiline(c.body)}
    </div>
    ${repliesHtml}
  </article>`;
}

// ─── Inline comment script (vanilla JS, no React, no deps) ─────

function renderCommentScript(args: {
  slug:         string;
  apiBaseUrl:   string;
  locale:       Locale;
  requireEmail: boolean;
}): string {
  const url = `${args.apiBaseUrl}/api/public/share/${encodeURIComponent(args.slug)}/comments`;
  const errorMsg = jsStr(T("commentError",       args.locale));
  const rateMsg  = jsStr(T("commentRateLimited", args.locale));
  const postingT = jsStr(T("posting",            args.locale));
  const postBtn  = jsStr(T("postBtn",            args.locale));
  return `
<script>
(function() {
  var form = document.getElementById('comment-form');
  if (!form) return;
  var submit = document.getElementById('cf-submit');
  var errBox = document.getElementById('cf-error');
  var list   = document.getElementById('comment-list');
  var FORM_RENDERED_AT = Date.now();

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
  }
  function clearError() {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearError();

    var fd = new FormData(form);
    var honeypot = fd.get('website_url') || '';
    if (honeypot) {
      // Bot caught — silently no-op so they don't learn.
      submit.textContent = ${postBtn};
      return;
    }
    if (Date.now() - FORM_RENDERED_AT < 2000) {
      // Form submitted too fast for a real human — silent no-op.
      return;
    }

    submit.disabled = true;
    submit.textContent = ${postingT};

    try {
      var payload = {
        authorName:  String(fd.get('authorName') || '').trim(),
        authorEmail: String(fd.get('authorEmail') || '').trim() || null,
        body:        String(fd.get('body') || '').trim(),
        renderedAt:  FORM_RENDERED_AT
      };
      var res = await fetch(${jsStr(url)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = {};
      try { body = await res.json(); } catch (_) {}
      if (!res.ok || body.ok === false) {
        if (res.status === 429) showError(${rateMsg});
        else showError(body.error || ${errorMsg});
        return;
      }
      // Optimistic insert.
      var article = document.createElement('article');
      article.style.cssText = 'padding: 12px 0; border-bottom: 1px solid ${PAL.glassBorder};';
      article.innerHTML =
        '<div style="font-size:13px; font-weight:700; color:${PAL.pearlWhite};">' +
        escapeHtml(payload.authorName) +
        '<span style="margin-left:8px; color:${PAL.pearlFaint}; font-weight:500; font-size:11px;">just now</span>' +
        '</div>' +
        '<div style="margin-top:6px; font-size:14px; color:${PAL.pearlDim}; line-height:1.6;">' +
        escapeHtml(payload.body).replace(/\\n/g, '<br>') +
        '</div>';
      // Insert at top of list (replace empty-state if present).
      var emptyMsg = list.querySelector('p');
      if (emptyMsg) list.removeChild(emptyMsg);
      list.insertBefore(article, list.firstChild);
      form.reset();
      FORM_RENDERED_AT = Date.now();
    } catch (err) {
      showError(${errorMsg});
    } finally {
      submit.disabled = false;
      submit.textContent = ${postBtn};
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
</script>`;
}

// ─── Cinematic state pages ──────────────────────────────────

export function renderPasswordGateHtml(args: {
  slug:        string;
  locale:      Locale;
  apiBaseUrl:  string;
  shareBaseUrl: string;
  appBaseUrl:  string;
  error?:      boolean;
}): string {
  const { slug, locale, error } = args;
  const dir = dirFor(locale);
  const formAction = `${args.shareBaseUrl}/${encodeURIComponent(slug)}`;

  return `<!DOCTYPE html>
<html lang="${attr(locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex,nofollow" />
<title>${esc(T("passwordPrompt", locale))} · ${esc(T("app", locale))}</title>
<style>${chromeCss(locale)}</style>
</head>
<body>
  <div class="gradient-mesh" aria-hidden="true"></div>
  <header class="app-bar">
    <a href="${attr(args.appBaseUrl)}" class="brand">Zyrix <span class="accent">FinSuite</span></a>
    <span class="copilot-tag"><span class="dot"></span>${esc(T("poweredBy", locale))}</span>
  </header>
  <div class="center-stage">
    <div class="glass-card">
      <div style="font-size: 32px; margin-bottom: 12px;">🔒</div>
      <h1 style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">${esc(T("passwordPrompt", locale))}</h1>
      <form method="POST" action="${attr(formAction)}" style="margin-top: 20px;">
        <input type="password" name="password" placeholder="${attr(T("passwordPlaceholder", locale))}" required style="width: 100%;" autofocus />
        ${error ? `<div class="error-banner">${esc(T("passwordError", locale))}</div>` : ""}
        <button type="submit" class="btn-primary" style="margin-top: 14px; width: 100%;">${esc(T("passwordCta", locale))}</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

export function renderExpiredHtml(args: { locale: Locale; appBaseUrl: string }): string {
  return renderStatePage({
    locale: args.locale,
    appBaseUrl: args.appBaseUrl,
    icon: "⏳",
    title: T("expiredTitle", args.locale),
    body: T("expiredBody", args.locale)
  });
}

export function renderRevokedHtml(args: { locale: Locale; appBaseUrl: string }): string {
  return renderStatePage({
    locale: args.locale,
    appBaseUrl: args.appBaseUrl,
    icon: "🗙",
    title: T("revokedTitle", args.locale),
    body: T("expiredBody", args.locale)
  });
}

export function renderNotFoundHtml(args: { locale: Locale; appBaseUrl: string }): string {
  return renderStatePage({
    locale: args.locale,
    appBaseUrl: args.appBaseUrl,
    icon: "🔍",
    title: T("notFoundTitle", args.locale),
    body: T("notFoundBody", args.locale)
  });
}

function renderStatePage(args: {
  locale:     Locale;
  appBaseUrl: string;
  icon:       string;
  title:      string;
  body:       string;
}): string {
  const { locale, appBaseUrl, icon, title, body } = args;
  const dir = dirFor(locale);
  return `<!DOCTYPE html>
<html lang="${attr(locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex,nofollow" />
<title>${esc(title)} · ${esc(T("app", locale))}</title>
<style>${chromeCss(locale)}</style>
</head>
<body>
  <div class="gradient-mesh" aria-hidden="true"></div>
  <header class="app-bar">
    <a href="${attr(appBaseUrl)}" class="brand">Zyrix <span class="accent">FinSuite</span></a>
    <span class="copilot-tag"><span class="dot"></span>${esc(T("poweredBy", locale))}</span>
  </header>
  <div class="center-stage">
    <div class="glass-card">
      <div style="font-size: 32px; margin-bottom: 14px;">${icon}</div>
      <h1 style="font-size: 22px; font-weight: 800; margin-bottom: 12px; letter-spacing:-0.01em;">${esc(title)}</h1>
      <p style="font-size: 14px; color:${PAL.pearlDim}; line-height: 1.6; margin-bottom: 22px;">${esc(body)}</p>
      <a href="${attr(appBaseUrl)}" class="btn-primary">${esc(T("goHome", locale))} →</a>
    </div>
  </div>
</body>
</html>`;
}

// ─── OG image HTML (1200x630, fed to ogImageRenderer) ─────────

export function renderOgImageHtml(args: {
  insight: RenderedInsight;
  locale:  Locale;
}): string {
  const { insight, locale } = args;
  const tone = SEV_TONE[insight.type] || SEV_TONE.ATTENTION;
  const sevLabel = tone.label[locale] || tone.label.tr;

  return `<!DOCTYPE html>
<html lang="${attr(locale)}" dir="${dirFor(locale)}">
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 1200px; height: 630px; overflow: hidden;
    background: ${PAL.bgDeep};
    color: ${PAL.pearlWhite};
    font-family: ${fontStack(locale)};
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative; width: 1200px; height: 630px;
    background:
      radial-gradient(ellipse 60% 50% at 22% 22%, rgba(157,78,221,0.55), transparent 60%),
      radial-gradient(ellipse 60% 50% at 78% 80%, rgba(0,217,255,0.45), transparent 60%),
      linear-gradient(135deg, ${PAL.bgDeep} 0%, ${PAL.bgDeep2} 100%);
    padding: 64px 72px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 10px 22px;
    background: ${tone.bg}; border: 2px solid ${tone.border};
    border-radius: 999px;
    color: ${tone.color};
    font-size: 18px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase;
  }
  .badge .dot { width: 12px; height: 12px; border-radius: 50%; background: ${tone.color}; }
  .title {
    font-size: 60px; font-weight: 800; line-height: 1.10; letter-spacing: -0.02em;
    color: ${PAL.pearlWhite};
    margin-top: 28px;
    max-height: 360px; overflow: hidden;
  }
  .footer {
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand { font-size: 28px; font-weight: 800; color: ${PAL.pearlWhite}; letter-spacing: -0.02em; }
  .brand .accent { color: ${PAL.cyanCore}; }
  .copilot {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px;
    background: rgba(157,78,221,0.10); border: 1px solid rgba(157,78,221,0.30);
    border-radius: 999px;
    color: #C8A2EC;
    font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  }
  .copilot .dot { width: 8px; height: 8px; border-radius: 50%; background: ${PAL.violet}; }
  .merchant {
    margin-top: 18px;
    font-size: 22px; color: ${PAL.pearlDim}; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="stage">
    <div>
      <div class="badge"><span class="dot"></span>${esc(sevLabel)}</div>
      <h1 class="title">${esc(insight.title)}</h1>
      <div class="merchant">${esc(insight.merchantName)}</div>
    </div>
    <div class="footer">
      <div class="brand">Zyrix <span class="accent">FinSuite</span></div>
      <div class="copilot"><span class="dot"></span>${esc(T("poweredBy", locale))}</div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Date formatting helpers ────────────────────────────────

function formatDate(d: Date, locale: Locale): string {
  const lc = locale === "tr" ? "tr-TR" : locale === "ar" ? "ar-EG" : "en-US";
  try {
    return new Intl.DateTimeFormat(lc, { year: "numeric", month: "short", day: "numeric" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatRelative(d: Date, locale: Locale): string {
  const diffMs = Date.now() - d.getTime();
  const lc = locale === "tr" ? "tr-TR" : locale === "ar" ? "ar-EG" : "en-US";
  const minutes = Math.floor(diffMs / 60_000);
  const hours   = Math.floor(diffMs / 3_600_000);
  const days    = Math.floor(diffMs / 86_400_000);
  if (minutes < 1)  return locale === "tr" ? "az önce" : locale === "ar" ? "للتو" : "just now";
  if (minutes < 60) return `${minutes}m`;
  if (hours   < 24) return `${hours}h`;
  if (days    < 7)  return `${days}d`;
  try {
    return new Intl.DateTimeFormat(lc, { month: "short", day: "numeric" }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}

function escMultiline(s: string): string {
  // Preserve paragraph breaks; escape HTML; convert \n to <br>.
  return esc(s).replace(/\r?\n/g, "<br>");
}
