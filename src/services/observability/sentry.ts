// ================================================================
// Sprint D-10 — Sentry SDK init + capture helpers.
//
// Per Mehmet's deferred-env-vars rule: SENTRY_DSN will land on
// Railway AFTER Phase B closes. Until then `initSentry()` returns
// false, every helper is a no-op, and the server boots cleanly.
//
// Decision §10.D — V1 ships WITHOUT source-map upload. Stack traces
// will group by minified frames; we re-symbolicate on demand if a
// specific error needs investigation.
// ================================================================
import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("[sentry] SENTRY_DSN not set; error tracking disabled.");
    return false;
  }
  try {
    Sentry.init({
      dsn,
      environment:      process.env.NODE_ENV || "development",
      release:          process.env.npm_package_version,
      // Decision §10.A — V1 ships LIGHTWEIGHT: errors only, no perf
      // sampling (no transaction overhead in production).
      tracesSampleRate: 0,
      // We DO NOT want PII shipped to Sentry by default. Merchant id
      // is opaque and safe; emails / phones are not. setMerchantContext
      // attaches the merchantId only.
      sendDefaultPii: false
    });
    initialized = true;
    console.log("[sentry] initialized.");
    return true;
  } catch (err: any) {
    console.error("[sentry] init failed:", err?.message || err);
    return false;
  }
}

/** Capture a thrown exception with optional structured context. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Capture a message (used for non-exception errors that still warrant attention). */
export function captureMessage(msg: string, level: "info" | "warning" | "error" = "error"): void {
  if (!initialized) return;
  Sentry.captureMessage(msg, level);
}

/**
 * Tag the current scope with the merchant making the request. Called
 * by the error handler after auth runs so 5xx responses carry the
 * merchant context for triage.
 */
export function setMerchantContext(merchantId: string | null | undefined): void {
  if (!initialized) return;
  Sentry.setUser(merchantId ? { id: merchantId } : null);
}

/** True after a successful initSentry() call. Used by tests + diagnostics. */
export function isSentryEnabled(): boolean {
  return initialized;
}
