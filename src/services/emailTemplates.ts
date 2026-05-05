// ============================================================
// Zyrix FinSuite — Email Templates Service
// Stage 8 Phase B — Auto-Provisioning System
//
// Trilingual welcome email templates (TR / EN / AR).
// Mirrors the design system used on the marketing site:
//   - Wine red theme for TR / EN
//   - Saudi green theme for AR
//   - Inter Tight typography (Cairo for AR)
//   - Glassmorphic-style cards
// ============================================================

export type EmailLanguage = "TR" | "EN" | "AR";

export type PlanWelcomeInput = {
  to: string;
  name: string;
  language: EmailLanguage;
  planId: string;
  planName: string;
  features: string[];
  loginUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
};

// ----------------------------------------------------------------
// Theme tokens per language
// ----------------------------------------------------------------

const THEME = {
  TR: {
    primary:    "#E30A17",
    primaryDeep:"#B30810",
    bgTinted:   "#FFF7F4",
    ink:        "#1B0F11",
    inkSoft:    "#5C4F52",
    fontFamily: "'Inter Tight', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    dir:        "ltr",
  },
  EN: {
    primary:    "#E30A17",
    primaryDeep:"#B30810",
    bgTinted:   "#FFF7F4",
    ink:        "#1B0F11",
    inkSoft:    "#5C4F52",
    fontFamily: "'Inter Tight', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    dir:        "ltr",
  },
  AR: {
    primary:    "#006C35",
    primaryDeep:"#004D26",
    bgTinted:   "#F0F9F4",
    ink:        "#1B0F11",
    inkSoft:    "#5C4F52",
    fontFamily: "'Cairo', 'Tajawal', system-ui, -apple-system, sans-serif",
    dir:        "rtl",
  },
};

// ----------------------------------------------------------------
// Per-language strings for plan welcome email
// ----------------------------------------------------------------

const STRINGS = {
  TR: {
    subject: "Zyrix FinSuite'e hosgeldiniz! Hesabiniz hazir.",
    preheader: "Hesabiniz aktif edildi. Tek tikla baslayin.",
    greeting: (name: string) => "Merhaba " + name + ",",
    intro1: "Zyrix FinSuite'e katildiginiz icin tesekkurler. Hesabiniz aktif edildi ve dashboard'unuza hazirsiniz.",
    intro2: "Asagidaki butona tiklayarak hemen baslayabilirsiniz.",
    planLabel: "Aktif planiniz:",
    featuresLabel: "Aktif edilen ozellikler:",
    cta: "Dashboard'a Giris",
    secondaryCta: "Hizli Baslangic Rehberi",
    footer1: "Sorulariniz icin destek@zyrix.co adresinden bize ulasabilirsiniz.",
    footer2: "Zyrix Global Technology - Istanbul, Turkiye",
    poweredBy: "Zyrix FinSuite tarafindan saglanmaktadir",
  },
  EN: {
    subject: "Welcome to Zyrix FinSuite! Your account is ready.",
    preheader: "Your account is active. Get started in one click.",
    greeting: (name: string) => "Hi " + name + ",",
    intro1: "Thanks for joining Zyrix FinSuite. Your account is active and your dashboard is ready.",
    intro2: "Click the button below to get started right away.",
    planLabel: "Your active plan:",
    featuresLabel: "Activated features:",
    cta: "Login to Dashboard",
    secondaryCta: "Quick Start Guide",
    footer1: "Questions? Reach us at support@zyrix.co.",
    footer2: "Zyrix Global Technology - Istanbul, Turkey",
    poweredBy: "Powered by Zyrix FinSuite",
  },
  AR: {
    subject: "مرحبا بك في Zyrix FinSuite! حسابك جاهز.",
    preheader: "تم تفعيل حسابك. ابدأ بنقرة واحدة.",
    greeting: (name: string) => "مرحبا " + name + "،",
    intro1: "شكرا لانضمامك الى Zyrix FinSuite. تم تفعيل حسابك ولوحة التحكم جاهزة.",
    intro2: "انقر على الزر ادناه لتبدأ على الفور.",
    planLabel: "خطتك النشطة:",
    featuresLabel: "الميزات المفعلة:",
    cta: "الدخول الى لوحة التحكم",
    secondaryCta: "دليل البدء السريع",
    footer1: "اي اسئلة؟ تواصل معنا على support@zyrix.co.",
    footer2: "Zyrix Global Technology - اسطنبول، تركيا",
    poweredBy: "مقدم من Zyrix FinSuite",
  },
};

// ----------------------------------------------------------------
// Friendly feature labels — shown in the email instead of raw codes
// ----------------------------------------------------------------

const FEATURE_LABELS: Record<EmailLanguage, Record<string, string>> = {
  TR: {
    EFATURA_CREATE: "e-Fatura olusturma",
    EFATURA_INCOMING: "Gelen e-Fatura takibi",
    EFATURA_OUTGOING: "Giden e-Fatura takibi",
    EARSIV_CREATE: "e-Arsiv fatura",
    ESMM_CREATE: "e-SMM (serbest meslek makbuzu)",
    EIRSALIYE_SEND: "e-Irsaliye",
    MOBILE_APP_ACCESS: "Mobil uygulama (iOS + Android)",
    MUHASEBECI_PANEL: "Muhasebeci paneli",
    ECOMMERCE_BASIC: "E-ticaret entegrasyonu",
    ONLINE_PAYMENTS: "Online tahsilat",
    INVOICE_PURCHASE: "Alis faturasi yonetimi",
    INVOICE_SALES: "Satis faturasi yonetimi",
    AR_AP_TRACKING: "Cari hesap takibi",
    QUOTE_CREATE: "Teklif ve siparis",
    STOCK_MANAGEMENT: "Stok yonetimi",
    CASHBOX: "Kasa yonetimi",
    BANK_TRACKING: "Banka takibi",
    CHEQUE_MANAGEMENT: "Cek yonetimi",
    RECEIPT_OCR: "Akilli fis okuma (OCR)",
    BANK_INTEGRATION: "Banka entegrasyonu (17 banka)",
    CRM_INTEGRATION: "CRM entegrasyonu",
    AI_CFO_DASHBOARD: "AI CFO panosu",
    ZYRIX_CRM_NATIVE: "Native Zyrix CRM",
    ZYRIX_PAY_GATEWAY: "Zyrix Pay odeme gecidi",
    MULTI_COUNTRY_TAX: "Cok ulkeli vergi motoru",
    TRILINGUAL_SUPPORT: "Uc dilli platform (TR/EN/AR)",
    EIMZA_FREE_1Y: "1 yil ucretsiz e-Imza",
    PRIORITY_SUPPORT: "Oncelikli destek",
  },
  EN: {
    EFATURA_CREATE: "Create e-Fatura invoices",
    EFATURA_INCOMING: "Incoming e-Fatura tracking",
    EFATURA_OUTGOING: "Outgoing e-Fatura tracking",
    EARSIV_CREATE: "e-Arsiv invoices",
    ESMM_CREATE: "e-SMM (self-employed receipts)",
    EIRSALIYE_SEND: "e-Irsaliye (e-waybills)",
    MOBILE_APP_ACCESS: "Mobile apps (iOS + Android)",
    MUHASEBECI_PANEL: "Accountant panel",
    ECOMMERCE_BASIC: "E-commerce integration",
    ONLINE_PAYMENTS: "Online payment collection",
    INVOICE_PURCHASE: "Purchase invoice management",
    INVOICE_SALES: "Sales invoice management",
    AR_AP_TRACKING: "Accounts receivable & payable",
    QUOTE_CREATE: "Quotes and orders",
    STOCK_MANAGEMENT: "Stock management",
    CASHBOX: "Cashbox management",
    BANK_TRACKING: "Bank account tracking",
    CHEQUE_MANAGEMENT: "Cheque management",
    RECEIPT_OCR: "Smart receipt OCR",
    BANK_INTEGRATION: "Bank integrations (17 banks)",
    CRM_INTEGRATION: "CRM integration",
    AI_CFO_DASHBOARD: "AI CFO dashboard",
    ZYRIX_CRM_NATIVE: "Native Zyrix CRM",
    ZYRIX_PAY_GATEWAY: "Zyrix Pay gateway",
    MULTI_COUNTRY_TAX: "Multi-country tax engine",
    TRILINGUAL_SUPPORT: "Trilingual platform (TR/EN/AR)",
    EIMZA_FREE_1Y: "1-year free e-Imza",
    PRIORITY_SUPPORT: "Priority support",
  },
  AR: {
    EFATURA_CREATE: "انشاء فواتير e-Fatura",
    EFATURA_INCOMING: "متابعة الفواتير الواردة",
    EFATURA_OUTGOING: "متابعة الفواتير الصادرة",
    EARSIV_CREATE: "فواتير e-Arsiv",
    ESMM_CREATE: "ايصالات e-SMM",
    EIRSALIYE_SEND: "بوليصات الشحن e-Irsaliye",
    MOBILE_APP_ACCESS: "تطبيقات الهاتف (iOS + Android)",
    MUHASEBECI_PANEL: "لوحة المحاسب",
    ECOMMERCE_BASIC: "تكامل التجارة الالكترونية",
    ONLINE_PAYMENTS: "تحصيل الدفع الالكتروني",
    INVOICE_PURCHASE: "ادارة فواتير الشراء",
    INVOICE_SALES: "ادارة فواتير البيع",
    AR_AP_TRACKING: "متابعة الذمم المدينة والدائنة",
    QUOTE_CREATE: "عروض الاسعار والطلبات",
    STOCK_MANAGEMENT: "ادارة المخزون",
    CASHBOX: "ادارة الصندوق",
    BANK_TRACKING: "متابعة الحسابات البنكية",
    CHEQUE_MANAGEMENT: "ادارة الشيكات",
    RECEIPT_OCR: "قراءة ذكية للايصالات (OCR)",
    BANK_INTEGRATION: "تكامل بنكي (17 بنك)",
    CRM_INTEGRATION: "تكامل CRM",
    AI_CFO_DASHBOARD: "لوحة AI CFO",
    ZYRIX_CRM_NATIVE: "Zyrix CRM المدمج",
    ZYRIX_PAY_GATEWAY: "بوابة الدفع Zyrix Pay",
    MULTI_COUNTRY_TAX: "محرك ضرائب متعدد الدول",
    TRILINGUAL_SUPPORT: "منصة ثلاثية اللغات (TR/EN/AR)",
    EIMZA_FREE_1Y: "توقيع الكتروني مجاني سنة كاملة",
    PRIORITY_SUPPORT: "دعم ذو اولوية",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getFeatureLabel(lang: EmailLanguage, code: string): string {
  return FEATURE_LABELS[lang][code] || code;
}

// ----------------------------------------------------------------
// Render the plan welcome email
// ----------------------------------------------------------------

export function renderPlanWelcome(input: PlanWelcomeInput): RenderedEmail {
  const lang   = input.language;
  const theme  = THEME[lang];
  const txt    = STRINGS[lang];

  // Limit to top 8 features in the email body
  const topFeatures = input.features.slice(0, 8);
  const featureItems = topFeatures
    .map((code) => {
      const label = escapeHtml(getFeatureLabel(lang, code));
      return (
        '<li style="margin: 8px 0; padding-' +
        (theme.dir === "rtl" ? "right" : "left") +
        ': 8px;">' + label + "</li>"
      );
    })
    .join("");

  const safeName  = escapeHtml(input.name);
  const safePlan  = escapeHtml(input.planName);
  const safeUrl   = encodeURI(input.loginUrl);

  const html = [
    '<!DOCTYPE html>',
    '<html lang="' + lang.toLowerCase() + '" dir="' + theme.dir + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + escapeHtml(txt.subject) + '</title>',
    '</head>',
    '<body style="margin:0; padding:0; background:' + theme.bgTinted + '; font-family:' + theme.fontFamily + ';">',
    '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' + escapeHtml(txt.preheader) + '</div>',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + theme.bgTinted + '; padding:32px 16px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:#ffffff; border-radius:20px; box-shadow:0 12px 40px rgba(58,5,9,0.06); overflow:hidden;">',
    // Header
    '<tr><td style="padding:32px 32px 16px 32px; background:linear-gradient(135deg, ' + theme.primary + ' 0%, ' + theme.primaryDeep + ' 100%); color:#ffffff;">',
    '<div style="font-size:24px; font-weight:800; letter-spacing:-0.02em;">Zyrix FinSuite</div>',
    '<div style="font-size:14px; opacity:0.9; margin-top:4px;">' + escapeHtml(txt.poweredBy) + '</div>',
    '</td></tr>',
    // Body
    '<tr><td style="padding:32px;">',
    '<h1 style="margin:0 0 16px 0; font-size:22px; font-weight:800; color:' + theme.ink + '; letter-spacing:-0.02em;">' + escapeHtml(txt.greeting(safeName)) + '</h1>',
    '<p style="margin:0 0 12px 0; font-size:15px; line-height:1.55; color:' + theme.inkSoft + ';">' + escapeHtml(txt.intro1) + '</p>',
    '<p style="margin:0 0 24px 0; font-size:15px; line-height:1.55; color:' + theme.inkSoft + ';">' + escapeHtml(txt.intro2) + '</p>',
    // Plan card
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + theme.bgTinted + '; border-radius:14px; padding:18px; margin-bottom:24px;">',
    '<tr><td>',
    '<div style="font-size:12px; font-weight:700; color:' + theme.inkSoft + '; text-transform:uppercase; letter-spacing:0.06em;">' + escapeHtml(txt.planLabel) + '</div>',
    '<div style="font-size:20px; font-weight:800; color:' + theme.primary + '; margin-top:4px;">' + safePlan + '</div>',
    '</td></tr>',
    '</table>',
    // Features list
    '<div style="font-size:13px; font-weight:700; color:' + theme.inkSoft + '; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;">' + escapeHtml(txt.featuresLabel) + '</div>',
    '<ul style="margin:0 0 28px 0; padding-' + (theme.dir === "rtl" ? "right" : "left") + ':20px; font-size:15px; line-height:1.6; color:' + theme.ink + ';">',
    featureItems,
    '</ul>',
    // CTA
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;">',
    '<tr><td style="border-radius:999px; background:' + theme.primary + ';">',
    '<a href="' + safeUrl + '" style="display:inline-block; padding:14px 28px; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; letter-spacing:-0.01em;">' + escapeHtml(txt.cta) + '</a>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    // Footer
    '<tr><td style="padding:24px 32px 32px 32px; background:' + theme.bgTinted + '; font-size:12px; line-height:1.5; color:' + theme.inkSoft + ';">',
    '<div>' + escapeHtml(txt.footer1) + '</div>',
    '<div style="margin-top:6px;">' + escapeHtml(txt.footer2) + '</div>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join("\n");

  return {
    subject: STRINGS[lang].subject,
    html,
  };
}

// ----------------------------------------------------------------
// Generic dispatcher — useful if more templates are added later
// ----------------------------------------------------------------

export function getEmailTemplate(
  name: "planWelcome",
  input: PlanWelcomeInput
): RenderedEmail {
  if (name === "planWelcome") {
    return renderPlanWelcome(input);
  }
  // Exhaustiveness fallback
  throw new Error("Unknown email template: " + String(name));
}
