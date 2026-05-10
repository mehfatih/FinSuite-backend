-- ================================================================
-- Sprint D-11 — Localization + country-aware behavior.
--
--   tax_rate_versions  — effective-dated tax rate history per
--                        (country, taxName). profileResolver picks
--                        the active row at invoice creation time.
--                        Existing Invoice.vatRate is preserved as
--                        the historical snapshot — old invoices
--                        keep rendering correctly.
--
--   invoices ALTER     — three nullable ZATCA Phase 2 columns:
--                        zatcaQrTlv (TEXT, base64 TLV blob),
--                        zatcaInvoiceHash (text, Phase 2 hash chain
--                        pointer placeholder), zatcaIsSimplified
--                        (boolean default false).
--
-- All idempotent. Matches D-3..D-10 convention.
-- ================================================================

-- ─── tax_rate_versions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tax_rate_versions" (
  "id"             TEXT      NOT NULL,
  "country"        TEXT      NOT NULL,
  "taxName"        TEXT      NOT NULL,
  "rate"           DECIMAL(5, 2) NOT NULL,
  "effectiveFrom"  TIMESTAMP NOT NULL,
  "effectiveTo"    TIMESTAMP,
  "createdBy"      TEXT      NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_rate_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tax_rate_versions_country_taxName_effectiveFrom_idx"
  ON "tax_rate_versions" ("country", "taxName", "effectiveFrom");

-- ─── invoices ZATCA columns (additive, all nullable) ──────────
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "zatcaQrTlv"         TEXT;
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "zatcaInvoiceHash"   TEXT;
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "zatcaIsSimplified"  BOOLEAN DEFAULT FALSE;
