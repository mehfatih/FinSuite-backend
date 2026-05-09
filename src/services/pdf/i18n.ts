// ================================================================
// i18n.ts — translation strings for PDF chrome (titles, badges,
// section headings, footers). Body content (insight title, body)
// flows through from the Insight row in whichever locale was used
// at generation time. This dictionary covers only the wrapper.
// ================================================================
import type { Locale } from './palette';

const DICT = {
  // Severity badges
  critical:        { tr: 'KRİTİK',                en: 'CRITICAL',          ar: 'حرج' },
  attention:       { tr: 'DİKKAT',                en: 'ATTENTION',         ar: 'تنبيه' },
  opportunity:     { tr: 'FIRSAT',                en: 'OPPORTUNITY',       ar: 'فرصة' },

  // Document titles
  insightTitle:    { tr: 'AI İçgörü',             en: 'AI Insight',        ar: 'رؤية ذكاء اصطناعي' },
  dailyBriefTitle: { tr: 'Günlük Brifing',        en: 'Daily Brief',       ar: 'الإيجاز اليومي' },
  rangeTitle:      { tr: 'Performans Raporu',     en: 'Performance Report', ar: 'تقرير الأداء' },

  // Section labels
  generated:       { tr: 'Oluşturuldu',           en: 'Generated',         ar: 'تم إنشاؤه' },
  generatedBy:     { tr: 'AI Co-Pilot tarafından', en: 'by AI Co-Pilot',   ar: 'بواسطة المساعد الذكي' },
  forMerchant:     { tr: 'için',                  en: 'for',               ar: 'لـ' },
  dateRange:       { tr: 'Tarih Aralığı',         en: 'Date Range',        ar: 'النطاق الزمني' },

  executiveSummary:{ tr: 'Yönetici Özeti',        en: 'Executive Summary', ar: 'الملخص التنفيذي' },
  keyMetrics:      { tr: 'Anahtar Metrikler',     en: 'Key Metrics',       ar: 'المقاييس الرئيسية' },
  insights:        { tr: 'İçgörüler',             en: 'Insights',          ar: 'الرؤى' },
  topCustomers:    { tr: 'Önde Gelen Müşteriler', en: 'Top Customers',     ar: 'كبار العملاء' },
  cashFlow:        { tr: 'Nakit Akışı',           en: 'Cash Flow',         ar: 'التدفق النقدي' },
  taxTimeline:     { tr: 'Vergi Takvimi',         en: 'Tax Timeline',      ar: 'الجدول الضريبي' },
  actionItems:     { tr: 'Eylem Maddeleri',       en: 'Action Items',      ar: 'بنود العمل' },

  // KPI labels (used in daily brief KPI snapshot tile)
  mrr:                  { tr: 'Aylık Gelir',         en: 'MRR',                  ar: 'الإيرادات الشهرية' },
  cashBalance:          { tr: 'Nakit',               en: 'Cash Balance',         ar: 'الرصيد النقدي' },
  cashRunwayDays:       { tr: 'Nakit Ömrü',          en: 'Cash Runway',          ar: 'فترة الأمان النقدي' },
  overdueReceivables:   { tr: 'Gecikmiş Alacaklar',  en: 'Overdue Receivables',  ar: 'الذمم المتأخرة' },
  pendingInvoices:      { tr: 'Bekleyen Faturalar',  en: 'Pending Invoices',     ar: 'فواتير معلقة' },
  newCustomers30d:      { tr: 'Yeni Müşteri (30g)',  en: 'New Customers (30d)',  ar: 'عملاء جدد (30 يوم)' },
  topCustomerRevenue:   { tr: 'En Büyük Müşteri',    en: 'Top Customer Revenue', ar: 'أكبر عميل' },
  taxBurden:            { tr: 'Vergi Yükü',          en: 'Tax Burden',           ar: 'العبء الضريبي' },
  customerHealthPct:    { tr: 'Müşteri Sağlığı',     en: 'Customer Health',      ar: 'صحة العملاء' },

  // Empty / fallback messages
  noInsights:      { tr: 'Bu dönem için içgörü bulunamadı', en: 'No insights found for this period', ar: 'لا توجد رؤى لهذه الفترة' },
  noData:          { tr: 'Veri yok',                       en: 'No data',                            ar: 'لا توجد بيانات' },

  // Footer
  generatedOn:     { tr: 'Tarihinde oluşturuldu',  en: 'Generated on',      ar: 'تاريخ الإنشاء' },
  pageOf:          { tr: 'Sayfa {n} / {total}',    en: 'Page {n} of {total}', ar: 'صفحة {n} من {total}' }
} as const;

type DictKey = keyof typeof DICT;

export function t(key: DictKey, locale: Locale): string {
  const entry = DICT[key];
  return entry[locale] || entry.en;
}

/** Page-N-of-M helper (handles RTL number direction). */
export function pageOf(n: number, total: number, locale: Locale): string {
  return t('pageOf', locale).replace('{n}', String(n)).replace('{total}', String(total));
}
