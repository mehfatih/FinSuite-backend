// ================================================================
// Sprint D-5 — Signed JWT for one-click unsubscribe / preference
// changes from the morning brief email footer.
//
// 90-day TTL so old emails still resolve. Distinct "sub" namespace
// (morning-brief-unsub:<merchantId>) prevents reuse as a regular
// auth token even though both are signed by env.jwtSecret.
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const TTL = "90d";
const SUB_PREFIX = "morning-brief-unsub:";

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
 * Cinematic landing page lives at /unsubscribe (B.8); the page POSTs
 * back to the API endpoint at /api/unsubscribe (B.6).
 */
export function buildUnsubUrl(merchantId: string): string {
  const base = process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co";
  const token = signUnsubToken(merchantId);
  return `${base.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;
}
