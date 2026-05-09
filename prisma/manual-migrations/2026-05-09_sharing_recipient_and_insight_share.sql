-- ================================================================
-- Sprint D-3 — Sharing tables
--   sharing_recipients   — saved recipients per merchant (accountant,
--                          partner, team, etc.); reused across shares
--   insight_shares       — immutable audit log of every share event
--                          (email or wa.me), with optional download
--                          tracking via the public /share/:token
--                          endpoint
-- Idempotent: every CREATE TABLE / INDEX / CONSTRAINT guarded with
-- IF NOT EXISTS, matching the project convention seen in
-- 2026-05-08_impersonation_columns.sql and
-- 2026-05-09_insight_model.sql.
-- ================================================================

-- ─────────────────────── sharing_recipients ─────────────────────
CREATE TABLE IF NOT EXISTS "sharing_recipients" (
  "id"          TEXT      NOT NULL,
  "merchantId"  TEXT      NOT NULL,
  "name"        TEXT      NOT NULL,
  "email"       TEXT,
  "phone"       TEXT,
  "role"        TEXT,
  "avatarUrl"   TEXT,
  "lastUsedAt"  TIMESTAMP,
  "shareCount"  INTEGER   NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sharing_recipients_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sharing_recipients_merchantId_fkey'
  ) THEN
    ALTER TABLE "sharing_recipients"
      ADD CONSTRAINT "sharing_recipients_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sharing_recipients_merchantId_lastUsedAt_idx"
  ON "sharing_recipients" ("merchantId", "lastUsedAt" DESC);

-- ─────────────────────── insight_shares ────────────────────────
CREATE TABLE IF NOT EXISTS "insight_shares" (
  "id"                 TEXT      NOT NULL,
  "merchantId"         TEXT      NOT NULL,
  "insightId"          TEXT,
  "reportType"         TEXT      NOT NULL,
  "channel"            TEXT      NOT NULL,
  "recipientId"        TEXT,
  "recipientSnapshot"  JSONB     NOT NULL,
  "message"            TEXT      NOT NULL,
  "pdfShareToken"      TEXT,
  "status"             TEXT      NOT NULL DEFAULT 'sent',
  "sentAt"             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt"        TIMESTAMP,
  "openedAt"           TIMESTAMP,
  "errorMessage"       TEXT,
  "downloadCount"      INTEGER   NOT NULL DEFAULT 0,
  "firstDownloadedAt"  TIMESTAMP,
  CONSTRAINT "insight_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "insight_shares_pdfShareToken_key"
  ON "insight_shares" ("pdfShareToken");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insight_shares_merchantId_fkey'
  ) THEN
    ALTER TABLE "insight_shares"
      ADD CONSTRAINT "insight_shares_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insight_shares_insightId_fkey'
  ) THEN
    ALTER TABLE "insight_shares"
      ADD CONSTRAINT "insight_shares_insightId_fkey"
      FOREIGN KEY ("insightId") REFERENCES "insights" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'insight_shares_recipientId_fkey'
  ) THEN
    ALTER TABLE "insight_shares"
      ADD CONSTRAINT "insight_shares_recipientId_fkey"
      FOREIGN KEY ("recipientId") REFERENCES "sharing_recipients" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for the two main query patterns:
--   1) recent shares for a merchant (audit log endpoint)
--   2) "what did I send to this recipient?" (per-recipient drill-down)
CREATE INDEX IF NOT EXISTS "insight_shares_merchantId_sentAt_idx"
  ON "insight_shares" ("merchantId", "sentAt" DESC);

CREATE INDEX IF NOT EXISTS "insight_shares_recipientId_sentAt_idx"
  ON "insight_shares" ("recipientId", "sentAt" DESC);
