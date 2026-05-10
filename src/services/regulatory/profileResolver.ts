// ================================================================
// Sprint D-11 — profileResolver(merchantId, asOf?).
//
// Returns the active regulatory profile for a merchant at a given
// point in time. The static profile (services/regulatory/profiles.ts)
// is the fallback; effective-dated overrides come from the
// TaxRateVersion table.
//
// Per discovery decision §10.C: the lookup picks the version row
// with the latest `effectiveFrom <= asOf` and either no `effectiveTo`
// or `asOf < effectiveTo`. If no row matches, the static profile's
// defaultRate is used (this is what powers the "old TR invoices stay
// at their stamped rate" backwards-compat path).
//
// Hard-rule: this file is the public read-only API the rest of the
// system uses. It does NOT modify protected files (aiBriefController,
// merchantSnapshot, kpiComputations) — they stay byte-for-byte
// unchanged.
// ================================================================
import { prisma } from "../../config/database";
import {
  getCountryProfile,
  normalizeCountry,
  CountryProfile,
  CountryCode
} from "./profiles";

export interface ResolvedProfile extends CountryProfile {
  /** Active rate at `asOf`; defaults to the static profile rate when no version row matches. */
  activeRate:        number;
  /** Source of the rate — useful for the admin UI + invoice diagnostics. */
  rateSource:        "static_default" | "tax_rate_version";
  /** Version id when the rate came from the version table; null on fallback. */
  rateVersionId:     string | null;
  /** The merchant's stored language — D-11 keeps language and country independent. */
  language:          "TR" | "AR" | "EN";
  /** The merchant's stored country — same value normalized. */
  country:           CountryCode;
}

interface ResolveArgs {
  merchantId: string;
  /** Point in time the profile is being resolved at. Defaults to now. */
  asOf?:      Date;
}

const TAX_NAME_BY_COUNTRY: Record<CountryCode, string> = {
  TR:    "KDV",
  SA:    "VAT",
  OTHER: "Sales Tax"
};

/**
 * Look up the effective tax rate for (country, taxName) at `asOf`.
 * Returns null when no version row matches — caller falls back to
 * the static profile's defaultRate.
 */
export async function resolveTaxRate(args: {
  country:  string;
  taxName:  string;
  asOf?:    Date;
}): Promise<{ rate: number; versionId: string } | null> {
  const asOf = args.asOf ?? new Date();
  const upper = args.country.toUpperCase();

  // ORDER BY effectiveFrom DESC LIMIT 1 — Prisma's findFirst with
  // orderBy gives us the most recent version covering `asOf`.
  const row = await prisma.taxRateVersion.findFirst({
    where: {
      country:  upper,
      taxName:  args.taxName,
      effectiveFrom: { lte: asOf },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: asOf } }
      ]
    },
    orderBy: { effectiveFrom: "desc" },
    select:  { id: true, rate: true }
  });

  if (!row) return null;
  // Prisma returns Decimal — coerce to number for downstream Intl/JSON.
  const rate = typeof row.rate === "number" ? row.rate : Number(row.rate);
  if (!Number.isFinite(rate)) return null;
  return { rate, versionId: row.id };
}

/**
 * Build the full resolved profile for a merchant at `asOf`.
 *
 * Caller flow:
 *   const profile = await resolveProfile({ merchantId, asOf: invoiceDate });
 *   invoice.vatRate = profile.activeRate;
 *   invoice.currency = profile.currency;
 */
export async function resolveProfile(args: ResolveArgs): Promise<ResolvedProfile> {
  const merchant = await prisma.merchant.findUnique({
    where:  { id: args.merchantId },
    select: { country: true, language: true, currency: true }
  });

  // Defensive: an unknown merchantId resolves to the OTHER profile so
  // callers don't crash. invoiceController validates merchantId from the
  // JWT before calling, so this branch should be unreachable in prod.
  const countryCode = normalizeCountry(merchant?.country);
  const profile     = getCountryProfile(countryCode);
  const taxName     = profile.tax.name;

  // Effective-dated rate lookup; null when no version row covers asOf.
  const versioned = await resolveTaxRate({
    country: countryCode,
    taxName,
    asOf: args.asOf
  });

  const activeRate    = versioned ? versioned.rate : profile.tax.defaultRate;
  const rateSource    = versioned ? "tax_rate_version" : "static_default";
  const rateVersionId = versioned ? versioned.versionId : null;

  // Merchant.language is a Language enum (AR | TR | EN). Keep typed.
  const language = (merchant?.language as "TR" | "AR" | "EN" | undefined) || profile.defaultLanguage;

  return {
    ...profile,
    activeRate,
    rateSource,
    rateVersionId,
    language,
    country: countryCode
  };
}
