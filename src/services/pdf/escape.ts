// ================================================================
// escape.ts — HTML escaping utilities for template literals.
// CRITICAL: every user / DB string interpolated into a template
// MUST go through `esc()` to prevent HTML injection / breakage.
// ================================================================

/** HTML-escape a string for safe interpolation in `<tag>${esc(x)}</tag>`. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Escape a string for use inside an HTML attribute value. */
export function attr(value: unknown): string {
  return esc(value);
}

/** Escape for use inside CSS strings (rare — used in url(...) etc.). */
export function cssEsc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\\"']/g, '\\$&');
}
