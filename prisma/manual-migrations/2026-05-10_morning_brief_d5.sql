-- ================================================================
-- Sprint D-5 — Daily AI Briefing Email Digest.
--   morning_brief_subscriptions — per-merchant opt-in + schedule;
--                                 bounce counter for auto-disable.
--   morning_brief_sends         — immutable send-log row; updated
--                                 by the Resend webhook handler.
--
-- Naming avoids collision with existing `customer_daily_brief`
-- (Phase 16 in-app cache table for the 3-card brief content).
--
-- Idempotent — every statement guarded with IF NOT EXISTS.
-- ================================================================

-- ─── morning_brief_subscriptions ──────────────────────────────
CREATE TABLE IF NOT EXISTS "morning_brief_subscriptions" (
  "id"             TEXT      NOT NULL,
  "merchantId"     TEXT      NOT NULL,
  "enabled"        BOOLEAN   NOT NULL DEFAULT TRUE,
  "frequency"      TEXT      NOT NULL DEFAULT 'daily',
  "weeklyDay"      INTEGER,
  "sendHourLocal"  INTEGER   NOT NULL DEFAULT 7,
  "lastSentAt"     TIMESTAMP,
  "bounceCount"    INTEGER   NOT NULL DEFAULT 0,
  "variant"        TEXT      NOT NULL DEFAULT 'v1',
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "morning_brief_subscriptions_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "morning_brief_subscriptions_merchantId_key" UNIQUE      ("merchantId")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'morning_brief_subscriptions_merchantId_fkey'
  ) THEN
    ALTER TABLE "morning_brief_subscriptions"
      ADD CONSTRAINT "morning_brief_subscriptions_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── morning_brief_sends ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "morning_brief_sends" (
  "id"                 TEXT      NOT NULL,
  "merchantId"         TEXT      NOT NULL,
  "variant"            TEXT      NOT NULL DEFAULT 'v1',
  "subject"            TEXT      NOT NULL,
  "insightIds"         TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[],
  "providerMessageId"  TEXT,
  "status"             TEXT      NOT NULL DEFAULT 'sent',
  "sentAt"             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt"        TIMESTAMP,
  "openedAt"           TIMESTAMP,
  "clickedAt"          TIMESTAMP,
  "bouncedAt"          TIMESTAMP,
  "bounceReason"       TEXT,
  "unsubscribeClicked" BOOLEAN   NOT NULL DEFAULT FALSE,
  CONSTRAINT "morning_brief_sends_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'morning_brief_sends_merchantId_fkey'
  ) THEN
    ALTER TABLE "morning_brief_sends"
      ADD CONSTRAINT "morning_brief_sends_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for the two main query patterns:
--   1) recent sends for a merchant (engagement stats; admin dashboard)
--   2) lookup by Resend message ID (webhook handler delivered/opened)
CREATE INDEX IF NOT EXISTS "morning_brief_sends_merchantId_sentAt_idx"
  ON "morning_brief_sends" ("merchantId", "sentAt" DESC);

CREATE INDEX IF NOT EXISTS "morning_brief_sends_providerMessageId_idx"
  ON "morning_brief_sends" ("providerMessageId");
