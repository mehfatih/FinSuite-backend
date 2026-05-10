// ================================================================
// Sprint D-6 — Signed JWT for one-click unsubscribe / preference
// changes from the weekly report email footer.
//
// Distinct namespace from D-5's morning-brief unsub tokens
// (decision §6.G option G1) — `weekly-report-unsub:<merchantId>`
// — so unsubscribing from one flow does NOT touch the other.
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const TTL = "90d";
const SUB_PREFIX = "weekly-report-unsub:";

export interface UnsubTokenPayload {
  merchantId: string;
}

export function signUnsubToken(merchantId: string): string {
  return jwt.sign(
    { sub: `${SUB_PREFIX}${merchantId}`, mid: merchantId },
    env.jwtSecret,
    { expiresIn: TTL } as any
  );
}

export function verifyUnsubToken(token: string): UnsubTokenPayload | null {
  try {
    const decoded: any = jwt.verify(token, env.jwtSecret);
    const sub = String(decoded?.sub || "");
    if (!sub.startsWith(SUB_PREFIX)) return null;
    const mid = String(decoded?.mid || "");
    if (!mid) return null;
    return { merchantId: mid };
  } catch {
    return null;
  }
}

/**
 * Build the user-facing unsubscribe URL the email footer points at.
 * Cinematic landing page lives at /unsubscribe-weekly (B.12); the
 * page POSTs back to /api/weekly-report/unsubscribe (B.8).
 */
export function buildUnsubUrl(merchantId: string): string {
  const base = process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co";
  const token = signUnsubToken(merchantId);
  return `${base.replace(/\/$/, "")}/unsubscribe-weekly?token=${encodeURIComponent(token)}`;
}
