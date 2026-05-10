// ================================================================
// Sprint D-9 — OAuth state CSRF token (decision §10.F option F1).
//
// Slack's OAuth `state` round-trips merchantId + a nonce. We sign
// it as a short-lived JWT so the callback can verify (a) the
// flow originated from a logged-in merchant in our app, (b) it
// hasn't been replayed past the 10-minute window. Reuses
// JWT_SECRET (same key powering D-4 streamToken, D-5/D-6 unsubscribe
// tokens).
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

const ISSUER  = "zyrix-finsuite-d9-slack-oauth";
const TTL_SEC = 10 * 60;

export interface SlackStatePayload {
  merchantId: string;
  nonce:      string;
  iss?:       string;
  iat?:       number;
  exp?:       number;
}

export function signSlackState(merchantId: string): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return jwt.sign(
    { merchantId, nonce },
    env.jwtSecret,
    { issuer: ISSUER, expiresIn: TTL_SEC as any }
  );
}

export function verifySlackState(state: string): SlackStatePayload {
  const decoded = jwt.verify(state, env.jwtSecret, { issuer: ISSUER }) as SlackStatePayload;
  if (!decoded.merchantId) throw new Error("Slack OAuth state missing merchantId.");
  return decoded;
}
