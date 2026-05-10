// ================================================================
// Sprint D-7 — IP hashing for view dedup + comment rate limit.
//
// We hash the client IP with a per-day salt so we can:
//   - count unique views without storing raw IPs (privacy + GDPR)
//   - rate-limit comments per IP per hour
//   - detect comment spam patterns without identifying individuals
//
// The per-day salt (env CRON_SECRET reused; rotates effectively
// when secret rotates) is hashed in so log dumps from one day
// can't be cross-referenced with another day's hashes.
// ================================================================
import crypto from "crypto";
import { Request } from "express";

const PER_DAY_SALT_PREFIX = "share-view-day:";

function dayStamp(when: Date = new Date()): string {
  // YYYY-MM-DD UTC — coarse-grained, but per-day rotation is the
  // privacy hinge. Hour-resolution would be excessive churn.
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  const d = String(when.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Extract the canonical client IP from an Express request. */
export function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "0.0.0.0";
}

/** Hash an IP address with the current day's salt. */
export function hashIp(ip: string, when: Date = new Date()): string {
  const secret = process.env.CRON_SECRET || "fallback-salt";
  const salt = `${PER_DAY_SALT_PREFIX}${dayStamp(when)}:${secret}`;
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Convenience: pull the IP off the request and hash it. */
export function hashRequestIp(req: Request): string {
  return hashIp(clientIp(req));
}
