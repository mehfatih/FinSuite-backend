-- ================================================================
-- Sprint D-5 — pause-30-days support for morning brief subscriptions.
-- Additive: lets the unsubscribe page offer a "pause" option without
-- flipping enabled=false, so the merchant doesn't have to manually
-- re-enable when the pause expires.
-- ================================================================

ALTER TABLE "morning_brief_subscriptions"
  ADD COLUMN IF NOT EXISTS "pausedUntil" TIMESTAMP;
