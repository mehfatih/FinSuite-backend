-- ================================================================
-- Sprint D-6 — Weekly Performance Report tables.
--   weekly_reports                — one row per merchant per ISO-week;
--                                   stores narrative + KPI snapshot +
--                                   insightIds. PDF is rendered on
--                                   demand (decision §6.B option B1).
--   weekly_report_subscriptions   — per-merchant opt-in + Sun 18:00
--                                   schedule + bounce counter.
--   weekly_report_sends           — immutable send log; webhook-updated
--                                   for delivered / opened / clicked /
--                                   bounced.
--
-- Idempotent — every statement guarded with IF NOT EXISTS.
-- ================================================================

-- ─── weekly_reports ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "weekly_reports" (
  "id"          TEXT      NOT NULL,
  "merchantId"  TEXT      NOT NULL,
  "weekStart"   DATE      NOT NULL,
  "weekEnd"     DATE      NOT NULL,
  "narrative"   TEXT      NOT NULL,
  "insightIds"  TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[],
  "kpiSnapshot" JSONB     NOT NULL,
  "language"    TEXT      NOT NULL DEFAULT 'tr',
  "status"      TEXT      NOT NULL DEFAULT 'ready',
  "generatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_reports_pkey"                       PRIMARY KEY ("id"),
  CONSTRAINT "weekly_reports_merchantId_weekStart_key"   UNIQUE      ("merchantId", "weekStart")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_reports_merchantId_fkey'
  ) THEN
    ALTER TABLE "weekly_reports"
      ADD CONSTRAINT "weekly_reports_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "weekly_reports_merchantId_weekStart_idx"
  ON "weekly_reports" ("merchantId", "weekStart" DESC);

-- ─── weekly_report_subscriptions ─────────────────────────────
CREATE TABLE IF NOT EXISTS "weekly_report_subscriptions" (
  "id"            TEXT      NOT NULL,
  "merchantId"    TEXT      NOT NULL,
  "enabled"       BOOLEAN   NOT NULL DEFAULT TRUE,
  "sendDayLocal"  INTEGER   NOT NULL DEFAULT 0,    -- 0=Sunday
  "sendHourLocal" INTEGER   NOT NULL DEFAULT 18,
  "lastSentAt"    TIMESTAMP,
  "pausedUntil"   TIMESTAMP,
  "bounceCount"   INTEGER   NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weekly_report_subscriptions_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "weekly_report_subscriptions_merchantId_key" UNIQUE      ("merchantId")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_report_subscriptions_merchantId_fkey'
  ) THEN
    ALTER TABLE "weekly_report_subscriptions"
      ADD CONSTRAINT "weekly_report_subscriptions_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── weekly_report_sends ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "weekly_report_sends" (
  "id"                 TEXT      NOT NULL,
  "merchantId"         TEXT      NOT NULL,
  "reportId"           TEXT      NOT NULL,
  "subject"            TEXT      NOT NULL,
  "providerMessageId"  TEXT,
  "status"             TEXT      NOT NULL DEFAULT 'sent',
  "sentAt"             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt"        TIMESTAMP,
  "openedAt"           TIMESTAMP,
  "clickedAt"          TIMESTAMP,
  "bouncedAt"          TIMESTAMP,
  "bounceReason"       TEXT,
  "unsubscribeClicked" BOOLEAN   NOT NULL DEFAULT FALSE,
  CONSTRAINT "weekly_report_sends_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_report_sends_merchantId_fkey'
  ) THEN
    ALTER TABLE "weekly_report_sends"
      ADD CONSTRAINT "weekly_report_sends_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_report_sends_reportId_fkey'
  ) THEN
    ALTER TABLE "weekly_report_sends"
      ADD CONSTRAINT "weekly_report_sends_reportId_fkey"
      FOREIGN KEY ("reportId") REFERENCES "weekly_reports" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "weekly_report_sends_merchantId_sentAt_idx"
  ON "weekly_report_sends" ("merchantId", "sentAt" DESC);

CREATE INDEX IF NOT EXISTS "weekly_report_sends_providerMessageId_idx"
  ON "weekly_report_sends" ("providerMessageId");
