// ================================================================
// Sprint D-11 — Country-aware AI persona prefix.
//
// Per discovery decision §10.O + the carry-over reminder: the new
// persona context layers ON TOP of the existing chat system prompt
// via a prefix. The existing systemPrompt(locale) string in
// services/chat/engine.ts stays unchanged — we just prepend a few
// sentences that orient the AI to the merchant's country
// (regulatory framework, currency, accounting terminology).
//
// CRITICAL: this module does NOT modify aiBriefController.ts /
// merchantSnapshot.ts / kpiComputations.ts. Those are protected
// per the carry-over hard rule. The aiBrief controller has its own
// (separate) prompt built directly from merchant data; the country-
// aware persona for that controller is a deferred follow-up.
//
// Three variants per country × three locales = 9 short strings
// that prepend the existing systemPrompt. Length kept short
// (<200 chars per variant) so token spend stays the same.
// ================================================================

export type PersonaCountry = "TR" | "SA" | "OTHER";
export type PersonaLocale  = "tr" | "en" | "ar";

/**
 * Build a short country-aware persona prefix that prepends the chat
 * system prompt. Returns "" when country=OTHER and locale=en (the
 * existing prompt's "Turkey/MENA SMB" line already covers that case
 * — no prefix needed).
 */
export function buildPersonaPrefix(country: PersonaCountry, locale: PersonaLocale): string {
  if (country === "TR") {
    if (locale === "ar") {
      return "السياق التجاري: التاجر مسجل في تركيا. النظام الضريبي: KDV (ضريبة القيمة المضافة التركية). العملة: ليرة تركية (TRY). نظام الفوترة الإلكترونية: e-Fatura (GİB). يجب الإشارة إلى المصطلحات التركية للمحاسبة عند الإجابة. ";
    }
    if (locale === "en") {
      return "Business context: merchant is registered in Turkey. Tax system: KDV (Turkish VAT). Currency: Turkish Lira (TRY). E-invoicing system: e-Fatura (GİB). Reference Turkish accounting terminology when answering. ";
    }
    return "İşletme bağlamı: tüccar Türkiye'de kayıtlı. Vergi sistemi: KDV (Katma Değer Vergisi). Para birimi: Türk Lirası (TRY). E-fatura sistemi: GİB e-Fatura. Cevaplarken Türk muhasebe terminolojisini kullan (KDV, mali müşavir, ciro, tahsilat, gelir/kurumlar vergisi). ";
  }

  if (country === "SA") {
    if (locale === "tr") {
      return "İşletme bağlamı: tüccar Suudi Arabistan'da kayıtlı. Vergi sistemi: VAT (KDV — %15). Para birimi: Suudi Riyali (SAR). E-fatura sistemi: ZATCA Phase 2 (sadeleştirilmiş ve standart fatura). Cevaplarken Suudi muhasebe terminolojisini kullan (ZATCA, hijri/miladi takvim, KSA özelinde uyum). ";
    }
    if (locale === "en") {
      return "Business context: merchant is registered in Saudi Arabia. Tax system: VAT (15%). Currency: Saudi Riyal (SAR). E-invoicing system: ZATCA Phase 2 (simplified and standard invoices). Reference Saudi accounting terminology when answering (ZATCA, Hijri/Gregorian calendar, KSA-specific compliance). ";
    }
    return "السياق التجاري: التاجر مسجل في المملكة العربية السعودية. النظام الضريبي: ضريبة القيمة المضافة (15%). العملة: ريال سعودي (SAR). نظام الفوترة الإلكترونية: ZATCA المرحلة الثانية (فاتورة مبسطة وقياسية). يجب استخدام المصطلحات المحاسبية السعودية في الإجابة (ZATCA، التقويم الهجري/الميلادي، الامتثال الخاص بالمملكة). ";
  }

  // OTHER — generic MENA persona
  if (locale === "ar") {
    return "السياق التجاري: التاجر في منطقة الشرق الأوسط وشمال أفريقيا. ";
  }
  if (locale === "tr") {
    return "İşletme bağlamı: tüccar MENA bölgesinde. ";
  }
  return ""; // existing English prompt already says "Turkey/MENA SMB"
}
