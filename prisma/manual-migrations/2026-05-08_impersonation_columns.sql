-- ================================================================
-- Phase 14 — Impersonation feature columns
-- Run on Railway Postgres console (NOT via prisma migrate deploy).
-- Idempotent: each statement guarded with IF NOT EXISTS.
-- ================================================================
-- The existing impersonation_sessions table (see schema.prisma) has:
--   id, adminUserId, customerUserId, reason, consentGranted,
--   consentToken, startedAt, endedAt, ipAddress
--
-- We add the columns the impersonate-real spec requires so the start
-- API can record adminEmail / target name / duration / expiry / endReason
-- / userAgent. We keep the original columns (adminUserId, customerUserId)
-- as the primary keys.
-- ================================================================

ALTER TABLE "impersonation_sessions"
  ADD COLUMN IF NOT EXISTS "adminEmail"         TEXT,
  ADD COLUMN IF NOT EXISTS "targetCustomerName" TEXT,
  ADD COLUMN IF NOT EXISTS "durationMinutes"    INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "expiresAt"          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "endReason"          TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent"          TEXT;

-- Backfill expiresAt for any historical rows so the NOT NULL we will
-- add later (optional) is safe. Default = startedAt + 30 minutes.
UPDATE "impersonation_sessions"
   SET "expiresAt" = "startedAt" + INTERVAL '30 minutes'
 WHERE "expiresAt" IS NULL;

-- Helpful index for the active-session lookup
CREATE INDEX IF NOT EXISTS "impersonation_sessions_expiresAt_idx"
  ON "impersonation_sessions" ("expiresAt");
