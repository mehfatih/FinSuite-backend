// ================================================================
// Sprint D-9 — Slack request signing-secret verification.
//
// Algorithm (per https://api.slack.com/authentication/verifying-requests-from-slack):
//   basestring = "v0:" + x-slack-request-timestamp + ":" + rawBody
//   expected   = "v0=" + hex(hmacSha256(SLACK_SIGNING_SECRET, basestring))
//   constantTime(expected, x-slack-signature)
//   reject if abs(now - timestamp) > 5 minutes  (replay protection)
//
// Mirrors the Resend webhook pattern in
// controllers/webhooks/resendWebhookController.ts:23-49 (Svix flavour).
// Differences: prefix `v0:`, hex output, single signature header.
//
// IMPORTANT: callers must mount with express.raw() so req.body is the
// raw Buffer. express.json() would have already consumed the body and
// the HMAC would never match.
// ================================================================
import crypto from "crypto";

const REPLAY_WINDOW_SECONDS = 5 * 60;

export interface VerifyArgs {
  rawBody:       Buffer;
  timestamp:     string;
  signature:     string;
  signingSecret: string;
  /** Optional now-override for tests; defaults to Date.now() / 1000. */
  nowSeconds?:   number;
}

export interface VerifyResult {
  ok:     boolean;
  reason?: "missing_headers" | "stale" | "bad_signature";
}

export function verifySlackSignature(args: VerifyArgs): VerifyResult {
  if (!args.timestamp || !args.signature || !args.signingSecret) {
    return { ok: false, reason: "missing_headers" };
  }
  const ts = parseInt(args.timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "missing_headers" };
  }
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const basestring = `v0:${args.timestamp}:${args.rawBody.toString("utf8")}`;
  const expected   = "v0=" + crypto
    .createHmac("sha256", args.signingSecret)
    .update(basestring)
    .digest("hex");

  // timingSafeEqual requires equal-length buffers — a length mismatch
  // would mean the header is malformed; treat as bad signature.
  const expBuf = Buffer.from(expected, "utf8");
  const sigBuf = Buffer.from(args.signature, "utf8");
  if (expBuf.length !== sigBuf.length) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(expBuf, sigBuf)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
