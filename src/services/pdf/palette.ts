// ================================================================
// palette.ts — server-side mirror of the D-1 cinematic tokens.
// Kept as a self-contained TS module so PDF templates have no
// runtime dependency on the frontend codebase.
//
// Two themes:
//   digital — dark canvas (#0A0E27 base) with full glows
//   print   — white canvas; same accents; glows degrade to soft drop-shadows
// ================================================================

export type Theme  = 'digital' | 'print';
export type Tone   = 'cyan' | 'violet' | 'mint' | 'amber' | 'crimson';
export type Locale = 'tr' | 'ar' | 'en';

// RGB triples (used by rgba() builders in templates).
export const RGB = {
  cyan:    '0, 217, 255',
  violet:  '157, 78, 221',
  mint:    '6, 255, 165',
  amber:   '255, 184, 0',
  crimson: '255, 61, 90'
} as const;

// Hex equivalents.
export const HEX = {
  cyan:    '#00D9FF',
  violet:  '#9D4EDD',
  mint:    '#06FFA5',
  amber:   '#FFB800',
  crimson: '#FF3D5A'
} as const;

// ─── Theme palettes ────────────────────────────────────────────
export interface PalettePack {
  bg:           string;   // page background
  surface:      string;   // card surface
  surfaceAlt:   string;   // alternate card
  border:       string;
  borderStrong: string;
  textPrimary:  string;
  textDim:      string;
  textFaint:    string;
  isDark:       boolean;
}

export const DIGITAL_PALETTE: PalettePack = {
  bg:           '#0A0E27',
  surface:      'rgba(255, 255, 255, 0.05)',
  surfaceAlt:   'rgba(255, 255, 255, 0.08)',
  border:       'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',
  textPrimary:  '#F8FAFC',
  textDim:      '#CBD5E1',
  textFaint:    '#64748B',
  isDark:       true
};

export const PRINT_PALETTE: PalettePack = {
  bg:           '#FFFFFF',
  surface:      '#FFFFFF',
  surfaceAlt:   '#F8FAFC',
  border:       'rgba(15, 23, 42, 0.08)',
  borderStrong: 'rgba(15, 23, 42, 0.16)',
  textPrimary:  '#0F172A',
  textDim:      '#475569',
  textFaint:    '#94A3B8',
  isDark:       false
};

export function paletteOf(theme: Theme): PalettePack {
  return theme === 'print' ? PRINT_PALETTE : DIGITAL_PALETTE;
}

// ─── Multi-layer glow / shadow factories ──────────────────────
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Cinematic glow (digital theme): three stacked box-shadows
 * (border-tinted ring + mid halo + outer halo).
 *
 * For the print theme, glows degrade to a tighter, lower-opacity
 * drop shadow + 1px tone-coloured border so they read on white
 * without saturating the page.
 */
export function glowOf(tone: Tone, theme: Theme, intensity: number = 2): string {
  const i = clamp(Math.round(intensity), 1, 3);
  const rgb = RGB[tone];

  if (theme === 'print') {
    return [
      `0 0 0 1px rgba(${rgb}, ${0.20 + i * 0.05})`,
      `0 ${2 + i * 2}px ${8 + i * 4}px rgba(${rgb}, ${0.08 + i * 0.04})`
    ].join(', ');
  }

  // digital theme — full neon multi-layer
  return [
    `0 0 0 1px rgba(${rgb}, ${0.18 + i * 0.06})`,
    `0 0 ${6 + i * 5}px rgba(${rgb}, ${0.18 + i * 0.10})`,
    `0 0 ${18 + i * 10}px rgba(${rgb}, ${0.10 + i * 0.06})`
  ].join(', ');
}

/** Aurora composite (violet + cyan) — used on AI insight surfaces. */
export function auroraOf(theme: Theme, intensity: number = 2): string {
  return `${glowOf('violet', theme, intensity)}, ${glowOf('cyan', theme, intensity)}`;
}

/** Tone-tinted soft fill background for a card (digital + print). */
export function tonedSurface(tone: Tone, theme: Theme): string {
  const rgb = RGB[tone];
  if (theme === 'print') {
    return `rgba(${rgb}, 0.06)`;
  }
  return `linear-gradient(135deg, rgba(${rgb}, 0.10) 0%, rgba(${rgb}, 0.04) 100%)`;
}

/** Tone color (foreground accent). */
export function toneColor(tone: Tone): string {
  return HEX[tone];
}

// ─── Cosmic mesh gradient (cover pages) ────────────────────────
export function cosmicMesh(): string {
  return [
    `radial-gradient(ellipse 60% 50% at 20% 30%, rgba(${RGB.violet}, 0.28), transparent 55%)`,
    `radial-gradient(ellipse 60% 55% at 80% 20%, rgba(${RGB.cyan},   0.22), transparent 60%)`,
    `radial-gradient(ellipse 55% 50% at 60% 80%, rgba(${RGB.mint},   0.16), transparent 55%)`,
    `radial-gradient(ellipse 60% 55% at 30% 75%, rgba(${RGB.amber},  0.14), transparent 60%)`,
    DIGITAL_PALETTE.bg
  ].join(', ');
}
