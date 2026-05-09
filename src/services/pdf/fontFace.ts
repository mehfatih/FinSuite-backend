// ================================================================
// fontFace.ts — emit a <style>@font-face block referencing the bundled
// .woff2 files via local file:// URLs. No Google Fonts CDN at PDF
// render time — Sprint D-2 hard constraint.
//
// Returns ONLY @font-face declarations (no other CSS); callers wrap
// these in a <style> tag and append the rest of the template's CSS.
// ================================================================
import { fontUrl } from './paths';

const WEIGHTS = [400, 500, 600, 700] as const;

function inter(weight: number, subset: 'latin' | 'latin-ext'): string {
  return `@font-face {
  font-family: 'Inter';
  font-weight: ${weight};
  font-style: normal;
  src: url('${fontUrl(`inter-${subset}-${weight}.woff2`)}') format('woff2');
  font-display: block;
  unicode-range: ${subset === 'latin'
    ? 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
    : 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF'};
}`;
}

function ibmPlexArabic(weight: number): string {
  return `@font-face {
  font-family: 'IBM Plex Sans Arabic';
  font-weight: ${weight};
  font-style: normal;
  src: url('${fontUrl(`ibm-plex-sans-arabic-${weight}.woff2`)}') format('woff2');
  font-display: block;
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC;
}`;
}

/**
 * Emit the @font-face block. Always include both Inter subsets and
 * Arabic; Chromium downloads only what it actually uses (so the
 * cost of "unused" families in a TR PDF is one HTTP-style HEAD per
 * unused face — negligible since they are local file://).
 */
export function fontFaceCss(): string {
  const parts: string[] = [];
  for (const w of WEIGHTS) {
    parts.push(inter(w, 'latin'));
    parts.push(inter(w, 'latin-ext'));
    parts.push(ibmPlexArabic(w));
  }
  return parts.join('\n');
}

/** Font stacks — choose by locale. Arabic templates pin Arabic family first. */
export const FONT_STACK = {
  latin:  `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  arabic: `'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif`
};

export function fontStackForLocale(locale: 'tr' | 'ar' | 'en'): string {
  return locale === 'ar' ? FONT_STACK.arabic : FONT_STACK.latin;
}
