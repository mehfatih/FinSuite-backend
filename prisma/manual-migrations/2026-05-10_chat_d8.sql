-- ================================================================
-- Sprint D-8 — AI Chat ("Ask Anything") tables.
--
--   chat_conversations — multi-turn chat threads, scoped to merchantId.
--                        Coexists with legacy ai_conversations (decision
--                        §7.A option A2) — no migration risk.
--                        retentionDays + expiresAt drive the cron-job.org
--                        nightly cleanup (decision §7.I).
--
--   chat_messages      — one row per message (user / assistant / tool).
--                        JSON columns capture tool calls / results /
--                        citations / charts / actions emitted by Gemini.
--                        tokensUsed + inputTokens + outputTokens +
--                        latencyMs feed D-10's per-merchant cost
--                        tracking (spec hard rule).
--
-- Idempotent — every CREATE / INDEX / CONSTRAINT guarded with
-- IF NOT EXISTS. Matches the project convention from D-3..D-7.
-- ================================================================

-- ─── chat_conversations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chat_conversations" (
  "id"            TEXT      NOT NULL,
  "merchantId"    TEXT      NOT NULL,
  "title"         TEXT      NOT NULL DEFAULT 'New Conversation',
  "pinned"        BOOLEAN   NOT NULL DEFAULT FALSE,
  "archived"      BOOLEAN   NOT NULL DEFAULT FALSE,
  "retentionDays" INTEGER   NOT NULL DEFAULT 90,
  "expiresAt"     TIMESTAMP,
  "lastMessageAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_merchantId_fkey'
  ) THEN
    ALTER TABLE "chat_conversations"
      ADD CONSTRAINT "chat_conversations_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_conversations_merchantId_lastMessageAt_idx"
  ON "chat_conversations" ("merchantId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "chat_conversations_merchantId_archived_idx"
  ON "chat_conversations" ("merchantId", "archived");
CREATE INDEX IF NOT EXISTS "chat_conversations_expiresAt_idx"
  ON "chat_conversations" ("expiresAt");

-- ─── chat_messages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id"             TEXT      NOT NULL,
  "conversationId" TEXT      NOT NULL,
  "role"           TEXT      NOT NULL,
  "content"        TEXT      NOT NULL,
  "toolCalls"      JSONB,
  "toolResults"    JSONB,
  "citations"      JSONB,
  "charts"         JSONB,
  "actions"        JSONB,
  "tokensUsed"     INTEGER,
  "inputTokens"    INTEGER,
  "outputTokens"   INTEGER,
  "latencyMs"      INTEGER,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_conversationId_fkey'
  ) THEN
    ALTER TABLE "chat_messages"
      ADD CONSTRAINT "chat_messages_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "chat_conversations" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_messages_conversationId_createdAt_idx"
  ON "chat_messages" ("conversationId", "createdAt" DESC);
