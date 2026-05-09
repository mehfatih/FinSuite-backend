// ================================================================
// _layout.ts — shared HTML skeleton, base CSS, footer, page-shell.
// Every PDF template wraps its body content in `htmlShell({...})`.
// ================================================================
import { fontFaceCss, fontStackForLocale } from '../fontFace';
import { paletteOf, Theme, Locale, cosmicMesh } from '../palette';
import { esc, attr } from '../escape';

/**
 * Top-level HTML shell. Templates pass the inner body content; this
 * builds the <head> with embedded @font-face, base CSS, and the
 * page-level layout.
 */
export function htmlShell(args: {
  title:           string;
  theme:           Theme;
  locale:          Locale;
  body:            string;     // already-escaped body HTML
  extraStyle?:     string;     // template-specific CSS appended after base
  pageBreaks?:     'auto' | 'avoid';
}): string {
  const dir = args.locale === 'ar' ? 'rtl' : 'ltr';
  const pal = paletteOf(args.theme);
  const stack = fontStackForLocale(args.locale);

  return `<!DOCTYPE html>
<html lang="${attr(args.locale)}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<title>${esc(args.title)}</title>
<style>
${fontFaceCss()}

* { margin: 0; padding: 0; box-sizing: border-box; }

@page {
  size: A4;
  margin: 16mm;
}

html, body {
  font-family: ${stack};
  background: ${pal.bg};
  color: ${pal.textPrimary};
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "kern" 1, "liga" 1;
  font-size: 11pt;
  line-height: 1.5;
}

/* Typography scale (print-tuned, pt-based) */
.t-display-xl { font-size: 40pt; line-height: 1.0;  font-weight: 700; letter-spacing: -0.04em; }
.t-display-lg { font-size: 32pt; line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; }
.t-display-md { font-size: 24pt; line-height: 1.1;  font-weight: 600; letter-spacing: -0.02em; }
.t-heading-lg { font-size: 16pt; font-weight: 600; line-height: 1.25; }
.t-heading-md { font-size: 13pt; font-weight: 600; line-height: 1.3; }
.t-body-lg    { font-size: 12pt; font-weight: 400; }
.t-body-md    { font-size: 11pt; font-weight: 400; }
.t-caption    { font-size: 9pt;  font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: ${pal.textFaint}; }

.t-dim    { color: ${pal.textDim}; }
.t-faint  { color: ${pal.textFaint}; }

/* Spacing */
.gap-1 { gap: 4pt; }   .gap-2 { gap: 8pt; }   .gap-3 { gap: 12pt; }
.gap-4 { gap: 16pt; }  .gap-6 { gap: 24pt; }  .gap-8 { gap: 32pt; }

.mt-1 { margin-top: 4pt; }    .mt-2 { margin-top: 8pt; }
.mt-3 { margin-top: 12pt; }   .mt-4 { margin-top: 16pt; }
.mt-6 { margin-top: 24pt; }   .mt-8 { margin-top: 32pt; }

.mb-1 { margin-bottom: 4pt; }   .mb-2 { margin-bottom: 8pt; }
.mb-3 { margin-bottom: 12pt; }  .mb-4 { margin-bottom: 16pt; }
.mb-6 { margin-bottom: 24pt; }

.flex { display: flex; }
.flex-col { display: flex; flex-direction: column; }
.items-center { align-items: center; }
.items-start  { align-items: flex-start; }
.justify-between { justify-content: space-between; }

/* Page-break helpers */
.page-break-before { page-break-before: always; }
.page-break-after  { page-break-after: always; }
.page-break-avoid  { page-break-inside: avoid; }

/* Card surfaces */
.card {
  background: ${pal.surface};
  ${pal.isDark ? `border: 1px solid ${pal.borderStrong};` : `border: 1px solid ${pal.border};`}
  border-radius: 14pt;
  padding: 16pt;
  ${pal.isDark ? '' : 'box-shadow: 0 1pt 3pt rgba(15, 23, 42, 0.06), 0 4pt 12pt rgba(15, 23, 42, 0.04);'}
}

/* Footer (rendered at the bottom of body content; CSS @page footers
   require Puppeteer headerTemplate/footerTemplate, omitted for stylistic
   control — we render footers as part of the body) */
.zyrix-footer {
  border-top: 1px solid ${pal.border};
  padding-top: 8pt;
  margin-top: 16pt;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 8pt;
  color: ${pal.textFaint};
  letter-spacing: 0.04em;
}
.zyrix-footer .brand {
  font-size: 9pt;
  font-weight: 700;
  color: ${pal.isDark ? '#F8FAFC' : '#0F172A'};
}
.zyrix-footer .brand .accent { color: #00D9FF; }

${args.extraStyle || ''}
</style>
</head>
<body>
${args.body}
</body>
</html>`;
}

/**
 * Footer block — placed at the bottom of every page-bound section.
 * Contains: merchant name | generation timestamp | Zyrix wordmark.
 */
export function footer(args: {
  merchantName: string;
  generatedAt:  Date;
  locale:       Locale;
  pageLabel?:   string;
}): string {
  const ts = formatDateTime(args.generatedAt, args.locale);
  return `<div class="zyrix-footer">
  <div>
    <span>${esc(args.merchantName)}</span>
    <span style="margin: 0 6pt; opacity: 0.5;">·</span>
    <span>${esc(ts)}</span>
    ${args.pageLabel ? `<span style="margin: 0 6pt; opacity: 0.5;">·</span><span>${esc(args.pageLabel)}</span>` : ''}
  </div>
  <div class="brand">Zyrix <span class="accent">FinSuite</span></div>
</div>`;
}

export function formatDate(d: Date, locale: Locale): string {
  const lc = locale === 'tr' ? 'tr-TR' : locale === 'ar' ? 'ar-SA' : 'en-US';
  try {
    return new Intl.DateTimeFormat(lc, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatDateTime(d: Date, locale: Locale): string {
  const lc = locale === 'tr' ? 'tr-TR' : locale === 'ar' ? 'ar-SA' : 'en-US';
  try {
    return new Intl.DateTimeFormat(lc, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function formatNumber(n: number | null | undefined, locale: Locale, currency?: string): string {
  if (n === null || n === undefined) return '—';
  const lc = locale === 'tr' ? 'tr-TR' : locale === 'ar' ? 'ar-SA' : 'en-US';
  if (currency) {
    try {
      return new Intl.NumberFormat(lc, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${currency} ${Math.round(n).toLocaleString()}`;
    }
  }
  try {
    return new Intl.NumberFormat(lc, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

/** Cover page background — full-bleed mesh, used by rangeReport. */
export function coverBackground(): string {
  return `<div style="
    position: absolute; inset: 0;
    background: ${cosmicMesh()};
    z-index: 0;
  "></div>
  <div style="
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at center, transparent 30%, rgba(10, 14, 39, 0.5) 100%);
    z-index: 0;
  "></div>`;
}
