-- ================================================================
-- Sprint D-7 — Public share links (anyone-with-link, no auth).
--
--   public_share_links  — 8-char base64url slug, points at an
--                         existing Insight / DailyBrief / WeeklyReport;
--                         privacy mode + password + expiry per row.
--                         Independent of D-3's insight_shares table.
--   share_comments      — public commenter (name + optional email +
--                         hashed IP); 1-level threading via parentId.
--   share_views         — view tracking with hashed IP for unique
--                         counts + optional geo.
--
-- Idempotent — every CREATE / INDEX / CONSTRAINT guarded with
-- IF NOT EXISTS.
-- ================================================================

-- ─── public_share_links ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_share_links" (
  "id"            TEXT      NOT NULL,
  "slug"          TEXT      NOT NULL,
  "merchantId"    TEXT      NOT NULL,
  "resourceType"  TEXT      NOT NULL,
  "resourceId"    TEXT      NOT NULL,
  "privacyMode"   TEXT      NOT NULL DEFAULT 'full',
  "expiresAt"     TIMESTAMP,
  "permanent"     BOOLEAN   NOT NULL DEFAULT FALSE,
  "passwordHash"  TEXT,
  "allowComments" BOOLEAN   NOT NULL DEFAULT TRUE,
  "requireEmail"  BOOLEAN   NOT NULL DEFAULT FALSE,
  "discoverable"  BOOLEAN   NOT NULL DEFAULT FALSE,
  "viewCount"     INTEGER   NOT NULL DEFAULT 0,
  "commentCount"  INTEGER   NOT NULL DEFAULT 0,
  "lastViewedAt"  TIMESTAMP,
  "revoked"       BOOLEAN   NOT NULL DEFAULT FALSE,
  "revokedAt"     TIMESTAMP,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT      NOT NULL,
  CONSTRAINT "public_share_links_pkey"     PRIMARY KEY ("id"),
  CONSTRAINT "public_share_links_slug_key" UNIQUE      ("slug")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'public_share_links_merchantId_fkey'
  ) THEN
    ALTER TABLE "public_share_links"
      ADD CONSTRAINT "public_share_links_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "merchants" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "public_share_links_slug_idx"
  ON "public_share_links" ("slug");
CREATE INDEX IF NOT EXISTS "public_share_links_merchantId_createdAt_idx"
  ON "public_share_links" ("merchantId", "createdAt" DESC);

-- ─── share_comments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "share_comments" (
  "id"           TEXT      NOT NULL,
  "shareLinkId"  TEXT      NOT NULL,
  "parentId"     TEXT,
  "authorName"   TEXT      NOT NULL,
  "authorEmail"  TEXT,
  "body"         TEXT      NOT NULL,
  "ipHash"       TEXT      NOT NULL,
  "hidden"       BOOLEAN   NOT NULL DEFAULT FALSE,
  "hiddenReason" TEXT,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_comments_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'share_comments_shareLinkId_fkey'
  ) THEN
    ALTER TABLE "share_comments"
      ADD CONSTRAINT "share_comments_shareLinkId_fkey"
      FOREIGN KEY ("shareLinkId") REFERENCES "public_share_links" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'share_comments_parentId_fkey'
  ) THEN
    ALTER TABLE "share_comments"
      ADD CONSTRAINT "share_comments_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "share_comments" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "share_comments_shareLinkId_createdAt_idx"
  ON "share_comments" ("shareLinkId", "createdAt" DESC);

-- ─── share_views ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "share_views" (
  "id"           TEXT      NOT NULL,
  "shareLinkId"  TEXT      NOT NULL,
  "ipHash"       TEXT      NOT NULL,
  "userAgent"    TEXT,
  "referer"      TEXT,
  "country"      TEXT,
  "viewedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "share_views_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'share_views_shareLinkId_fkey'
  ) THEN
    ALTER TABLE "share_views"
      ADD CONSTRAINT "share_views_shareLinkId_fkey"
      FOREIGN KEY ("shareLinkId") REFERENCES "public_share_links" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "share_views_shareLinkId_viewedAt_idx"
  ON "share_views" ("shareLinkId", "viewedAt" DESC);
