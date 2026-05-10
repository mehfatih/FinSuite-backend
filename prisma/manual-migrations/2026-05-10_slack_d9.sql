-- ================================================================
-- Sprint D-9 — Slack workspace integration tables.
--
--   slack_installations    — one row per Slack workspace a merchant
--                            connects. botToken / incomingWebhookUrl
--                            are AES-256-GCM ciphertext (utils/
--                            encryption.ts; reuses 2FA's ENCRYPTION_KEY).
--                            uninstalledAt is soft-delete; the channel
--                            driver filters on IS NULL.
--
--   slack_channel_mappings — per-(installation, severity) routing rule.
--                            insightType IN ('CRITICAL','ATTENTION',
--                            'OPPORTUNITY','SHARE_EVENT','all').
--                            Spec hard rule: no defaults to #general.
--
--   slack_outbound_logs    — outbound audit + idempotency. Channel
--                            driver checks for ok=true row keyed on
--                            (installationId, insightId) before sending.
--
-- Plus additive ALTERs on notification_preferences for the slack /
-- teams channel toggles (decision §10 / discovery §5.3). Teams columns
-- ship now even though the Teams driver is deferred (decision §10.A) —
-- adding two boolean + one array column is cheaper than a second
-- migration when Teams lands.
--
-- Idempotent — every CREATE / INDEX / CONSTRAINT guarded with
-- IF NOT EXISTS. Matches D-3..D-8 convention.
-- ================================================================

-- ─── slack_installations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slack_installations" (
  "id"                  TEXT      NOT NULL,
  "merchantId"          TEXT      NOT NULL,
  "workspaceId"         TEXT      NOT NULL,
  "workspaceName"       TEXT      NOT NULL,
  "botToken"            TEXT      NOT NULL,
  "botUserId"           TEXT      NOT NULL,
  "incomingWebhookUrl"  TEXT,
  "scope"               TEXT      NOT NULL,
  "installedAt"         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uninstalledAt"       TIMESTAMP,
  CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'slack_installations_merchantId_fkey'
  ) THEN
    ALTER TABLE "slack_installations"
      ADD CONSTRAINT "slack_installations_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slack_installations_merchantId_workspaceId_key'
  ) THEN
    ALTER TABLE "slack_installations"
      ADD CONSTRAINT "slack_installations_merchantId_workspaceId_key"
      UNIQUE ("merchantId", "workspaceId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "slack_installations_merchantId_uninstalledAt_idx"
  ON "slack_installations" ("merchantId", "uninstalledAt");

-- ─── slack_channel_mappings ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "slack_channel_mappings" (
  "id"              TEXT      NOT NULL,
  "installationId"  TEXT      NOT NULL,
  "insightType"     TEXT      NOT NULL,
  "channelId"       TEXT      NOT NULL,
  "channelName"     TEXT      NOT NULL,
  "enabled"         BOOLEAN   NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "slack_channel_mappings_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'slack_channel_mappings_installationId_fkey'
  ) THEN
    ALTER TABLE "slack_channel_mappings"
      ADD CONSTRAINT "slack_channel_mappings_installationId_fkey"
      FOREIGN KEY ("installationId") REFERENCES "slack_installations" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'slack_channel_mappings_installationId_insightType_channelId_key'
  ) THEN
    ALTER TABLE "slack_channel_mappings"
      ADD CONSTRAINT "slack_channel_mappings_installationId_insightType_channelId_key"
      UNIQUE ("installationId", "insightType", "channelId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "slack_channel_mappings_installationId_enabled_idx"
  ON "slack_channel_mappings" ("installationId", "enabled");

-- ─── slack_outbound_logs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "slack_outbound_logs" (
  "id"              TEXT      NOT NULL,
  "installationId"  TEXT      NOT NULL,
  "insightId"       TEXT,
  "notificationId"  TEXT,
  "channelId"       TEXT      NOT NULL,
  "slackTs"         TEXT,
  "ok"              BOOLEAN   NOT NULL,
  "errorCode"       TEXT,
  "rawError"        TEXT,
  "postedAt"        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "slack_outbound_logs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'slack_outbound_logs_installationId_fkey'
  ) THEN
    ALTER TABLE "slack_outbound_logs"
      ADD CONSTRAINT "slack_outbound_logs_installationId_fkey"
      FOREIGN KEY ("installationId") REFERENCES "slack_installations" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "slack_outbound_logs_installationId_postedAt_idx"
  ON "slack_outbound_logs" ("installationId", "postedAt");
CREATE INDEX IF NOT EXISTS "slack_outbound_logs_insightId_idx"
  ON "slack_outbound_logs" ("insightId");

-- ─── notification_preferences additive columns ───────────────
-- All ADD COLUMN IF NOT EXISTS — safe to re-run.
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "slackEnabled"   BOOLEAN  NOT NULL DEFAULT FALSE;
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "teamsEnabled"   BOOLEAN  NOT NULL DEFAULT FALSE;
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "slackChannels"  TEXT[]   NOT NULL DEFAULT ARRAY['CRITICAL','ATTENTION']::TEXT[];
ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "teamsChannels"  TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[];
