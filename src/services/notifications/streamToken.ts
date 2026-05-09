// ================================================================
// streamToken.ts — short-lived JWT for SSE auth.
// EventSource API can't send Authorization headers, so the client
// fetches a one-shot stream token from a normal authenticated
// endpoint, then opens an SSE connection with `?token=…`.
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const ISSUER         = "zyrix-finsuite-d4-stream";
const DEFAULT_EXPIRY = "5m";

export interface StreamTokenPayload {
  merchantId: string;
  iat?:       number;
  exp?:       number;
  iss?:       string;
}

export function signStreamToken(merchantId: string, expiresIn: string = DEFAULT_EXPIRY): string {
  return jwt.sign(
    { merchantId },
    env.jwtSecret,
    { issuer: ISSUER, expiresIn: expiresIn as any }
  );
}

export function verifyStreamToken(token: string): StreamTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { issuer: ISSUER }) as StreamTokenPayload;
  if (!decoded.merchantId) throw new Error("Stream token missing merchantId.");
  return decoded;
}
