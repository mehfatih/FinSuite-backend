// ================================================================
// phone.ts — E.164 phone normalization for sharing recipients.
// Strict: rejects anything that doesn't look like a real phone.
// wa.me URLs need digits-only (no leading "+"), so we expose
// both `e164(phone)` (with +) and `digits(phone)` (digits only).
// ================================================================

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Normalize free-form phone input to canonical E.164 with leading "+". */
export function e164(phone: string): string | null {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^0-9+]/g, "");
  // Must start with "+" (international) and have only digits after.
  if (!cleaned.startsWith("+")) return null;
  const digitsOnly = cleaned.slice(1);
  if (!/^[0-9]+$/.test(digitsOnly)) return null;
  if (digitsOnly.length < MIN_DIGITS || digitsOnly.length > MAX_DIGITS) return null;
  return "+" + digitsOnly;
}

/** Digits only (no leading "+", no spaces). For wa.me URL paths. */
export function digits(phone: string): string | null {
  const ok = e164(phone);
  return ok ? ok.slice(1) : null;
}

/** Boolean validator — true iff the input is a clean E.164 phone. */
export function isValidE164(phone: string): boolean {
  return e164(phone) !== null;
}
