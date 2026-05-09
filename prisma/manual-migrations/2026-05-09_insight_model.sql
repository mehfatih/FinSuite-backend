-- ================================================================
-- Sprint D-1 — Insight model
-- Adds the immutable insight-history table that coexists with
-- customer_daily_brief (per-day cache, overwrites on refresh).
-- Idempotent: every statement guarded with IF NOT EXISTS.
-- ================================================================
-- Coexistence rule: customer_daily_brief stays as the same-day cache;
-- insights is the historical log. The aiBriefController writes one
-- Insight row per generated card (3 per refresh) in addition to the
-- existing cache upsert. No migration of CustomerDailyBrief data.
-- ================================================================

-- Enums (Postgres needs each value to exist; we recreate idempotently
-- by checking pg_type before adding).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InsightType') THEN
    CREATE TYPE "InsightType"   AS ENUM ('CRITICAL', 'ATTENTION', 'OPPORTUNITY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InsightStatus') THEN
    CREATE TYPE "InsightStatus" AS ENUM ('ACTIVE', 'DISMISSED', 'RESOLVED', 'ARCHIVED');
  END IF;
END $$;

-- Table
CREATE TABLE IF NOT EXISTS "insights" (
  "id"          TEXT          NOT NULL,
  "merchantId"  TEXT          NOT NULL,
  "type"        "InsightType" NOT NULL,
  "category"    TEXT          NOT NULL,
  "title"       TEXT          NOT NULL,
  "body"        TEXT          NOT NULL,
  "ctaLabel"    TEXT,
  "ctaRoute"    TEXT,
  "numericRefs" JSONB,
  "language"    TEXT          NOT NULL,
  "source"      TEXT          NOT NULL,
  "status"      "InsightStatus" NOT NULL DEFAULT 'ACTIVE',
  "generatedAt" TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP,
  "dismissedAt" TIMESTAMP,
  "resolvedAt"  TIMESTAMP,
  CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- FK + cascade
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insights_merchantId_fkey'
  ) THEN
    ALTER TABLE "insights"
      ADD CONSTRAINT "insights_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for the two query patterns:
--   1. recent active insights for a merchant (history endpoint)
--   2. counts by type×status (analytics, ops dashboard)
CREATE INDEX IF NOT EXISTS "insights_merchantId_status_generatedAt_idx"
  ON "insights" ("merchantId", "status", "generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "insights_merchantId_type_status_idx"
  ON "insights" ("merchantId", "type", "status");
