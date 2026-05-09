-- ================================================================
-- Sprint D-4 — Notification system tables.
--   Extends `notifications` table additively with the cinematic-center
--   columns (severity / iconTone / cta* / channelsSent / insightId /
--   shareId / readAt / archived) so all 8 existing controllers keep
--   writing to it unchanged.
--
--   Adds two new tables: notification_preferences (per-merchant prefs)
--   and web_push_subscriptions (one row per browser endpoint).
--
--   Adds InsightShare.providerMessageId so the Resend webhook handler
--   can find the row by message ID when it fires email.delivered /
--   email.opened.
--
-- Idempotent — every statement guarded with IF NOT EXISTS.
-- ================================================================

-- ─── notifications: additive columns ──────────────────────────
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "severity"     TEXT,
  ADD COLUMN IF NOT EXISTS "iconTone"     TEXT,
  ADD COLUMN IF NOT EXISTS "ctaLabel"     TEXT,
  ADD COLUMN IF NOT EXISTS "ctaRoute"     TEXT,
  ADD COLUMN IF NOT EXISTS "channelsSent" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "insightId"    TEXT,
  ADD COLUMN IF NOT EXISTS "shareId"      TEXT,
  ADD COLUMN IF NOT EXISTS "readAt"       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "archived"     BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_insightId_fkey') THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "notifications_insightId_fkey"
      FOREIGN KEY ("insightId") REFERENCES "insights" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "notifications_merchantId_isRead_createdAt_idx"
  ON "notifications" ("merchantId", "isRead", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "notifications_merchantId_archived_createdAt_idx"
  ON "notifications" ("merchantId", "archived", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "notifications_insightId_idx"
  ON "notifications" ("insightId");

-- ─── notification_preferences ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id"                  TEXT      NOT NULL,
  "merchantId"          TEXT      NOT NULL,
  "inappEnabled"        BOOLEAN   NOT NULL DEFAULT TRUE,
  "emailEnabled"        BOOLEAN   NOT NULL DEFAULT TRUE,
  "webPushEnabled"      BOOLEAN   NOT NULL DEFAULT FALSE,
  "mobilePushEnabled"   BOOLEAN   NOT NULL DEFAULT FALSE,
  "criticalChannels"    TEXT[]    NOT NULL DEFAULT ARRAY['inapp','email','webpush']::TEXT[],
  "attentionChannels"   TEXT[]    NOT NULL DEFAULT ARRAY['inapp','email']::TEXT[],
  "opportunityChannels" TEXT[]    NOT NULL DEFAULT ARRAY['inapp']::TEXT[],
  "shareEventChannels"  TEXT[]    NOT NULL DEFAULT ARRAY['inapp']::TEXT[],
  "digestFrequency"     TEXT      NOT NULL DEFAULT 'instant',
  "quietHoursStart"     INTEGER,
  "quietHoursEnd"       INTEGER,
  "mutedUntil"          TIMESTAMP,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_merchantId_key" UNIQUE      ("merchantId")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_merchantId_fkey') THEN
    ALTER TABLE "notification_preferences"
      ADD CONSTRAINT "notification_preferences_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── web_push_subscriptions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
  "id"          TEXT      NOT NULL,
  "merchantId"  TEXT      NOT NULL,
  "endpoint"    TEXT      NOT NULL,
  "p256dh"      TEXT      NOT NULL,
  "auth"        TEXT      NOT NULL,
  "userAgent"   TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_push_subscriptions_pkey"         PRIMARY KEY ("id"),
  CONSTRAINT "web_push_subscriptions_endpoint_key" UNIQUE      ("endpoint")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'web_push_subscriptions_merchantId_fkey') THEN
    ALTER TABLE "web_push_subscriptions"
      ADD CONSTRAINT "web_push_subscriptions_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "web_push_subscriptions_merchantId_idx"
  ON "web_push_subscriptions" ("merchantId");

-- ─── insight_shares.providerMessageId (D-3 follow-up) ──────────
ALTER TABLE "insight_shares"
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;

CREATE INDEX IF NOT EXISTS "insight_shares_providerMessageId_idx"
  ON "insight_shares" ("providerMessageId");
