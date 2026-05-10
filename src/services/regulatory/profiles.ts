// ================================================================
// Sprint D-11 — Backend country/regulatory profiles.
//
// Per discovery decision §10.B option B1 — backend mirror of the
// frontend src/utils/countryProfiles.js, narrowed to the V1
// supported countries (TR + SA) plus an "OTHER" fallback. Static
// rates here are the FALLBACK historical defaults; effective-dated
// overrides come from the TaxRateVersion table via profileResolver.
//
// Hard-rule reminder: no edits to aiBriefController.ts /
// merchantSnapshot.ts / kpiComputations.ts — those read merchant
// fields directly. This file is a NEW public read-only API surface.
// ================================================================

export type CountryCode = "TR" | "SA" | "OTHER";

export interface CountryProfile {
  code:           CountryCode;
  name:           { tr: string; en: string; ar: string };
  defaultLanguage: "TR" | "AR" | "EN";
  currency:       string;             // ISO 4217 (TRY / SAR / USD)
  currencySymbol: string;
  intlLocale:     string;             // for Intl.NumberFormat / DateTimeFormat
  dateFormat:     string;             // human-readable hint (formatting goes through Intl)
  weekStart:      "monday" | "sunday";
  tax: {
    name:                 string;     // 'KDV' / 'VAT'
    fullName:             { tr: string; en: string; ar: string };
    /** Historical default rate when no TaxRateVersion exists. */
    defaultRate:          number;
    /** All allowed rates merchants can pick from on an invoice. */
    additionalRates:      number[];
  };
  regulatory: {
    eInvoiceSystem:    string;        // 'e-Fatura' / 'ZATCA' / 'Standard'
    eInvoiceAuthority: { tr: string; en: string; ar: string };
    /** TR only: GİB threshold above which e-Fatura is mandatory. */
    efaturaThresholdRevenueTRY?: number;
    /** SA only: ZATCA phase. V1 ships Phase 2 XML on demand. */
    zatcaPhase?:                  "phase1" | "phase2";
    /** SA only: B2C invoices below this threshold are simplified. */
    zatcaSimplifiedThresholdSAR?: number;
  };
  intl: {
    decimal:   "." | ",";
    thousands: "." | "," | " ";
  };
}

const PROFILES: Record<CountryCode, CountryProfile> = {
  TR: {
    code: "TR",
    name: { tr: "Türkiye", en: "Turkey", ar: "تركيا" },
    defaultLanguage: "TR",
    currency:       "TRY",
    currencySymbol: "₺",
    intlLocale:     "tr-TR",
    dateFormat:     "DD/MM/YYYY",
    weekStart:      "monday",
    tax: {
      name:     "KDV",
      fullName: { tr: "Katma Değer Vergisi", en: "Value Added Tax", ar: "ضريبة القيمة المضافة" },
      defaultRate:     20,
      additionalRates: [1, 10, 20]
    },
    regulatory: {
      eInvoiceSystem:    "e-Fatura",
      eInvoiceAuthority: { tr: "GİB", en: "GIB", ar: "GİB" },
      // GİB current threshold (~5M TRY annual revenue) per the latest
      // Resmi Gazete reform. Versionable via TaxRateVersion (a parallel
      // "threshold" version table is V2 work — for V1 this is a static
      // value; admin edits would be a follow-up).
      efaturaThresholdRevenueTRY: 5_000_000
    },
    intl: { decimal: ",", thousands: "." }
  },

  SA: {
    code: "SA",
    name: { tr: "Suudi Arabistan", en: "Saudi Arabia", ar: "السعودية" },
    defaultLanguage: "AR",
    currency:       "SAR",
    currencySymbol: "ر.س",
    intlLocale:     "ar-SA",
    dateFormat:     "DD/MM/YYYY",
    weekStart:      "sunday",
    tax: {
      name:     "VAT",
      fullName: { tr: "KDV", en: "Value Added Tax", ar: "ضريبة القيمة المضافة" },
      defaultRate:     15,
      additionalRates: [0, 15]
    },
    regulatory: {
      eInvoiceSystem:    "ZATCA",
      eInvoiceAuthority: { tr: "ZATCA", en: "ZATCA", ar: "هيئة الزكاة والضريبة والجمارك" },
      zatcaPhase:                "phase2",
      zatcaSimplifiedThresholdSAR: 1000
    },
    intl: { decimal: ".", thousands: "," }
  },

  OTHER: {
    code: "OTHER",
    name: { tr: "Diğer", en: "Other", ar: "أخرى" },
    defaultLanguage: "EN",
    currency:       "USD",
    currencySymbol: "$",
    intlLocale:     "en-US",
    dateFormat:     "MM/DD/YYYY",
    weekStart:      "sunday",
    tax: {
      name:     "Sales Tax",
      fullName: { tr: "Satış Vergisi", en: "Sales Tax", ar: "ضريبة المبيعات" },
      defaultRate:     0,
      additionalRates: [0]
    },
    regulatory: {
      eInvoiceSystem:    "Standard",
      eInvoiceAuthority: { tr: "Standart", en: "Standard", ar: "قياسي" }
    },
    intl: { decimal: ".", thousands: "," }
  }
};

/** Normalize an ISO country code into a key our profile map handles. */
export function normalizeCountry(code: string | null | undefined): CountryCode {
  if (!code) return "OTHER";
  const upper = code.toUpperCase();
  if (upper === "TR" || upper === "SA") return upper;
  return "OTHER";
}

/** Static profile lookup. For dynamic tax rates use profileResolver. */
export function getCountryProfile(code: string | null | undefined): CountryProfile {
  return PROFILES[normalizeCountry(code)];
}

/** Pick a UI language from a country code (signup default only). */
export function defaultLanguageForCountry(code: string | null | undefined): "TR" | "AR" | "EN" {
  return getCountryProfile(code).defaultLanguage;
}

/** All profiles — for the admin tax-rate editor's country dropdown. */
export function listProfiles(): CountryProfile[] {
  return [PROFILES.TR, PROFILES.SA];
}
