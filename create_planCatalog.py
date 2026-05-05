# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Step 2: Create src/config/planCatalog.ts
# Backend mirror of frontend planCatalog.js
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
CONFIG_DIR = ROOT / "src" / "config"
TARGET = CONFIG_DIR / "planCatalog.ts"

print("=" * 70)
print("CREATE src/config/planCatalog.ts")
print("=" * 70)

# Verify config dir exists
if not CONFIG_DIR.exists():
    print("[FAIL] Config dir not found: " + str(CONFIG_DIR))
    raise SystemExit(1)

print("[OK] Config dir exists: " + str(CONFIG_DIR))

# Check existing files in config dir
print()
print("Existing files in src/config/:")
for f in sorted(CONFIG_DIR.iterdir()):
    print("     - " + f.name + " (" + str(f.stat().st_size) + " bytes)")
print()

# Check if target already exists
if TARGET.exists():
    print("[WARN] planCatalog.ts already exists (" + str(TARGET.stat().st_size) + " bytes)")
    print("       Will be OVERWRITTEN.")
    print()

content = '''// ============================================================
// Zyrix FinSuite — Backend Plan Catalog
// Single source of truth for plan pricing, feature flags, and metadata
// on the server side. Mirrors frontend src/utils/planCatalog.js.
//
// Stage 8 Phase B — Auto-Provisioning System
// ============================================================

import { PlanName } from "@prisma/client";

// ----------------------------------------------------------------
// Plan IDs (frontend-facing) and mapping to Prisma enum
// ----------------------------------------------------------------
export type PlanId = "eDonusum" | "onMuhasebe" | "pro";

export const PLAN_IDS: PlanId[] = ["eDonusum", "onMuhasebe", "pro"];

export const PLAN_TO_ENUM: Record<PlanId, PlanName> = {
  eDonusum: "E_DONUSUM" as PlanName,
  onMuhasebe: "ON_MUHASEBE" as PlanName,
  pro: "PRO" as PlanName,
};

// ----------------------------------------------------------------
// Pricing per country
// Currency is implicit — derived from country profile.
// monthly = local-currency price billed monthly
// yearly  = local-currency price billed monthly when paying yearly
// ----------------------------------------------------------------
type PriceTuple = { monthly: number; yearly: number };
type CountryPricing = Record<PlanId, PriceTuple>;

export const PLAN_PRICING: Record<string, CountryPricing> = {
  TR: {
    eDonusum:   { monthly: 463, yearly: 370 },
    onMuhasebe: { monthly: 463, yearly: 370 },
    pro:        { monthly: 738, yearly: 590 },
  },
  SA: {
    eDonusum:   { monthly: 99,  yearly: 79  },
    onMuhasebe: { monthly: 99,  yearly: 79  },
    pro:        { monthly: 159, yearly: 127 },
  },
  AE: {
    eDonusum:   { monthly: 99,  yearly: 79  },
    onMuhasebe: { monthly: 99,  yearly: 79  },
    pro:        { monthly: 159, yearly: 127 },
  },
  EG: {
    eDonusum:   { monthly: 499,  yearly: 399  },
    onMuhasebe: { monthly: 499,  yearly: 399  },
    pro:        { monthly: 799,  yearly: 639  },
  },
  KW: {
    eDonusum:   { monthly: 9,   yearly: 7  },
    onMuhasebe: { monthly: 9,   yearly: 7  },
    pro:        { monthly: 15,  yearly: 12 },
  },
  QA: {
    eDonusum:   { monthly: 99,  yearly: 79  },
    onMuhasebe: { monthly: 99,  yearly: 79  },
    pro:        { monthly: 159, yearly: 127 },
  },
  BH: {
    eDonusum:   { monthly: 9,   yearly: 7  },
    onMuhasebe: { monthly: 9,   yearly: 7  },
    pro:        { monthly: 15,  yearly: 12 },
  },
  OM: {
    eDonusum:   { monthly: 9,   yearly: 7  },
    onMuhasebe: { monthly: 9,   yearly: 7  },
    pro:        { monthly: 15,  yearly: 12 },
  },
  JO: {
    eDonusum:   { monthly: 19,  yearly: 15 },
    onMuhasebe: { monthly: 19,  yearly: 15 },
    pro:        { monthly: 29,  yearly: 23 },
  },
  US: {
    eDonusum:   { monthly: 29,  yearly: 23 },
    onMuhasebe: { monthly: 29,  yearly: 23 },
    pro:        { monthly: 49,  yearly: 39 },
  },
};

// ----------------------------------------------------------------
// Currency code per country (for subscription persistence)
// ----------------------------------------------------------------
export const COUNTRY_CURRENCY: Record<string, string> = {
  TR: "TRY",
  SA: "SAR",
  AE: "AED",
  EG: "EGP",
  KW: "KWD",
  QA: "QAR",
  BH: "BHD",
  OM: "OMR",
  JO: "JOD",
  US: "USD",
};

// ----------------------------------------------------------------
// Feature codes enabled per plan
// These are persisted as rows in the FeatureFlag table.
// Pro plan inherits eDonusum + onMuhasebe + its own extras.
// ----------------------------------------------------------------
export const PLAN_FEATURE_CODES: Record<PlanId, string[]> = {
  eDonusum: [
    "EFATURA_CREATE",
    "EFATURA_INCOMING",
    "EFATURA_OUTGOING",
    "EARSIV_CREATE",
    "ESMM_CREATE",
    "EIRSALIYE_SEND",
    "MOBILE_APP_ACCESS",
    "MUHASEBECI_PANEL",
    "ECOMMERCE_BASIC",
    "ONLINE_PAYMENTS",
  ],
  onMuhasebe: [
    "INVOICE_PURCHASE",
    "INVOICE_SALES",
    "AR_AP_TRACKING",
    "QUOTE_CREATE",
    "STOCK_MANAGEMENT",
    "CASHBOX",
    "BANK_TRACKING",
    "CHEQUE_MANAGEMENT",
    "RECEIPT_OCR",
    "BANK_INTEGRATION",
    "CRM_INTEGRATION",
  ],
  pro: [
    "AI_CFO_DASHBOARD",
    "ZYRIX_CRM_NATIVE",
    "ZYRIX_PAY_GATEWAY",
    "MULTI_COUNTRY_TAX",
    "TRILINGUAL_SUPPORT",
    "EIMZA_FREE_1Y",
    "PRIORITY_SUPPORT",
  ],
};

// ----------------------------------------------------------------
// Plan display metadata (English-only on backend; frontend handles i18n)
// ----------------------------------------------------------------
export const PLAN_META: Record<PlanId, { name: string; tagline: string }> = {
  eDonusum: {
    name: "e-Donusum",
    tagline: "Complete digital transformation: e-Fatura, e-Arsiv, e-SMM.",
  },
  onMuhasebe: {
    name: "On Muhasebe",
    tagline: "Pre-accounting essentials: invoices, stock, cashbox, banking.",
  },
  pro: {
    name: "Pro",
    tagline: "Everything in e-Donusum + On Muhasebe, plus AI CFO and Zyrix exclusives.",
  },
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Returns the full feature-code list for a plan.
 * Pro returns the union of eDonusum + onMuhasebe + pro extras (deduped).
 */
export function getFeatureCodes(planId: PlanId): string[] {
  if (planId === "pro") {
    const merged = new Set<string>([
      ...PLAN_FEATURE_CODES.eDonusum,
      ...PLAN_FEATURE_CODES.onMuhasebe,
      ...PLAN_FEATURE_CODES.pro,
    ]);
    return Array.from(merged);
  }
  return [...PLAN_FEATURE_CODES[planId]];
}

/**
 * Looks up the price for a plan in a given country and billing interval.
 * Falls back to TR pricing if the country is not in the catalog.
 * Returns null if the plan is unknown.
 */
export function getPlanPrice(
  planId: PlanId,
  country: string,
  billing: "monthly" | "yearly"
): number | null {
  const cc = (country || "TR").toUpperCase();
  const profile = PLAN_PRICING[cc] || PLAN_PRICING.TR;
  const tuple = profile[planId];
  if (!tuple) return null;
  return tuple[billing];
}

/**
 * Returns the ISO currency code for a country.
 * Falls back to TRY if the country is not in the catalog.
 */
export function getCurrency(country: string): string {
  const cc = (country || "TR").toUpperCase();
  return COUNTRY_CURRENCY[cc] || "TRY";
}

/**
 * Validates that a string is a known plan id. Useful for narrowing
 * untrusted input from request bodies.
 */
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as string[]).includes(value);
}

/**
 * Validates that a string is a known country code. Returns the
 * upper-cased value if known, otherwise null.
 */
export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cc = value.toUpperCase();
  return PLAN_PRICING[cc] ? cc : null;
}
'''

TARGET.write_text(content, encoding="utf-8")

print("[OK] File written: " + str(TARGET))
print("     Size: " + str(TARGET.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
written = TARGET.read_text(encoding="utf-8")
checks = [
    ("export type PlanId", "export type PlanId" in written),
    ("PLAN_TO_ENUM",        "PLAN_TO_ENUM" in written),
    ("PLAN_PRICING.TR",     '"TR":' not in written and "TR:" in written),
    ("PLAN_FEATURE_CODES",  "PLAN_FEATURE_CODES" in written),
    ("getFeatureCodes",     "export function getFeatureCodes" in written),
    ("getPlanPrice",        "export function getPlanPrice" in written),
    ("getCurrency",         "export function getCurrency" in written),
    ("isPlanId",            "export function isPlanId" in written),
    ("normalizeCountry",    "export function normalizeCountry" in written),
    ("E_DONUSUM mapping",   '"E_DONUSUM"' in written),
    ("ON_MUHASEBE mapping", '"ON_MUHASEBE"' in written),
    ("AI_CFO_DASHBOARD",    '"AI_CFO_DASHBOARD"' in written),
]
for label, ok in checks:
    print("     " + label.ljust(25) + " -> " + ("OK" if ok else "MISSING"))
print()

print("=" * 70)
print("[DONE] planCatalog.ts created. Send output to Claude.")
print("=" * 70)