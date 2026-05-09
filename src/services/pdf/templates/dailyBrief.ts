// ================================================================
// Template 2 — Daily Brief (1-2 pages A4).
// Header band: "Daily Brief — {merchantName} — {date}".
// Three insight cards stacked.
// 2×2 KPI snapshot tile.
// Footer with Zyrix branding.
// ================================================================
import { htmlShell, footer, formatDate } from './_layout';
import { aiInsightCard, constellationKpiGrid } from './charts';
import { t } from '../i18n';
import { paletteOf, Theme, Locale, RGB } from '../palette';
import { esc } from '../escape';

export interface DailyBriefCard {
  type:        'CRITICAL' | 'ATTENTION' | 'OPPORTUNITY';
  title:       string;
  body:        string;
  ctaLabel?:   string;
}

export interface DailyBriefData {
  date:         Date;
  merchantName: string;
  cards:        DailyBriefCard[];                  // up to 3
  kpis:         Record<string, number | null>;     // mrr, cash_balance, overdue_receivables, tax_burden, etc.
  currency?:    string;
}

export function renderDailyBriefTemplate(args: {
  data:   DailyBriefData;
  theme:  Theme;
  locale: Locale;
}): string {
  const pal      = paletteOf(args.theme);
  const data     = args.data;
  const currency = data.currency || 'TRY';
  const sym      = currency === 'TRY' ? '₺' : currency === 'SAR' ? 'SAR ' : currency === 'USD' ? '$' : '';
  const fmtCur   = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;

  // Order cards by severity (critical → attention → opportunity)
  const orderedCards = sortCards(data.cards);

  const cardsHtml = orderedCards.length > 0
    ? orderedCards.map((c) => `
        <div style="margin-bottom: 12pt;">
          ${aiInsightCard({
            severity:    severityKey(c.type),
            title:       c.title,
            description: c.body,
            actionLabel: c.ctaLabel,
            badgeText:   t(severityKey(c.type), args.locale),
            theme:       args.theme
          })}
        </div>
      `).join('')
    : `<div class="card" style="text-align: center; padding: 32pt;">
        <span class="t-caption" style="color: ${pal.textFaint};">${esc(t('noInsights', args.locale))}</span>
       </div>`;

  // KPI snapshot tile (4 KPIs in a 2×2 grid for the daily brief)
  const kpiArray = buildKpiArray(data.kpis, args.locale, fmtCur);
  const kpiSnapshot = kpiArray.length > 0 ? `
    <div class="page-break-avoid mt-6">
      <div class="t-caption mb-3">${esc(t('keyMetrics', args.locale))}</div>
      ${constellationKpiGrid({
        kpis:  kpiArray.slice(0, 4),
        theme: args.theme
      })}
    </div>
  ` : '';

  const body = `
    <div style="display: flex; flex-direction: column; min-height: 235mm;">
      <!-- Header band -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end;
                  padding: 18pt 0; border-bottom: 1px solid ${pal.border}; margin-bottom: 18pt;">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('dailyBriefTitle', args.locale))}</div>
          <div class="t-display-md" style="color: ${pal.textPrimary}; margin-top: 4pt;">
            ${esc(data.merchantName)}
          </div>
        </div>
        <div style="text-align: ${args.locale === 'ar' ? 'left' : 'right'};">
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('generated', args.locale))}</div>
          <div class="t-heading-md" style="color: ${pal.textDim}; margin-top: 4pt;">
            ${esc(formatDate(data.date, args.locale))}
          </div>
        </div>
      </div>

      <!-- Insight cards -->
      ${cardsHtml}

      <!-- KPI snapshot -->
      ${kpiSnapshot}

      <div style="flex: 1;"></div>

      <!-- Generated-by tag -->
      <div style="margin-top: 24pt; display: inline-flex; align-items: center; gap: 6pt;
                  font-size: 8pt; color: ${pal.textFaint}; letter-spacing: 0.06em;">
        <span style="display: inline-block; width: 6pt; height: 6pt; border-radius: 50%;
                     background: #9D4EDD; box-shadow: 0 0 4pt rgba(${RGB.violet}, 0.7);"></span>
        ${esc(t('generatedBy', args.locale))}
      </div>

      ${footer({
        merchantName: data.merchantName,
        generatedAt:  data.date,
        locale:       args.locale
      })}
    </div>
  `;

  return htmlShell({
    title:  `${t('dailyBriefTitle', args.locale)} — ${esc(data.merchantName)} — ${formatDate(data.date, args.locale)}`,
    theme:  args.theme,
    locale: args.locale,
    body
  });
}

// ─── Helpers ────────────────────────────────────────────────

function severityKey(type: 'CRITICAL' | 'ATTENTION' | 'OPPORTUNITY'): 'critical' | 'attention' | 'opportunity' {
  return type.toLowerCase() as any;
}

function sortCards(cards: DailyBriefCard[]): DailyBriefCard[] {
  const order = { CRITICAL: 0, ATTENTION: 1, OPPORTUNITY: 2 } as const;
  return [...cards].sort((a, b) => order[a.type] - order[b.type]);
}

function buildKpiArray(
  kpis: Record<string, number | null>,
  locale: Locale,
  fmtCur: (n: number) => string
): Array<{ label: string; value: number; tone: any; format: (n: number) => string }> {
  const fmtNum = (n: number) => Math.round(n).toLocaleString();
  const fmtPct = (n: number) => `${n.toFixed(0)}%`;
  const fmtDays = (n: number) => `${Math.round(n)}d`;

  const map: Array<{ refKey: string; labelKey: any; tone: any; format: (n: number) => string }> = [
    { refKey: 'mrr',                  labelKey: 'mrr',                tone: 'cyan',    format: fmtCur },
    { refKey: 'cash_balance',         labelKey: 'cashBalance',        tone: 'mint',    format: fmtCur },
    { refKey: 'cash_runway_days',     labelKey: 'cashRunwayDays',     tone: 'mint',    format: fmtDays },
    { refKey: 'overdue_receivables',  labelKey: 'overdueReceivables', tone: 'amber',   format: fmtCur },
    { refKey: 'tax_burden',           labelKey: 'taxBurden',          tone: 'crimson', format: fmtCur },
    { refKey: 'top_customer_revenue', labelKey: 'topCustomerRevenue', tone: 'violet',  format: fmtCur },
    { refKey: 'pending_invoices',     labelKey: 'pendingInvoices',    tone: 'cyan',    format: fmtNum },
    { refKey: 'new_customers_30d',    labelKey: 'newCustomers30d',    tone: 'mint',    format: fmtNum },
    { refKey: 'customer_health_pct',  labelKey: 'customerHealthPct',  tone: 'mint',    format: fmtPct }
  ];
  return map
    .filter((m) => typeof kpis[m.refKey] === 'number' && Number.isFinite(kpis[m.refKey] as number))
    .map((m) => ({
      label:  t(m.labelKey, locale),
      value:  kpis[m.refKey] as number,
      tone:   m.tone,
      format: m.format
    }));
}
