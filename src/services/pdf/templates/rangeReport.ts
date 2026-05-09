// ================================================================
// Template 3 — Custom-range Performance Report (3-8 pages A4).
// Pages:
//   Cover page:        full-bleed mesh, title, date range, merchant
//   Executive summary: text + KPI tiles
//   Insights:          grouped by date, paginated
//   Optional sections: top customers, cash flow, tax timeline
//   Final page:        action items + Zyrix CTA footer
// ================================================================
import { htmlShell, footer, formatDate, coverBackground } from './_layout';
import {
  aiInsightCard, constellationKpiGrid, holographicDonut, flowStream,
  pulseSparkline
} from './charts';
import { t } from '../i18n';
import { paletteOf, Theme, Locale, RGB, Tone, toneColor } from '../palette';
import { esc } from '../escape';

export type SectionKey = 'insights' | 'kpis' | 'customers' | 'taxes' | 'cashflow';

export interface RangeInsight {
  type:        'CRITICAL' | 'ATTENTION' | 'OPPORTUNITY';
  title:       string;
  body:        string;
  ctaLabel?:   string;
  generatedAt: Date;
}

export interface RangeKpi {
  key:    string;
  value:  number;
  delta?: number;
}

export interface CustomerSlice { name: string; value: number; }
export interface CashFlowBucket { name: string; value: number; }
export interface TaxItem        { title: string; dueDate: Date; amount?: number; isSubmitted: boolean; }

export interface RangeReportData {
  startDate:    Date;
  endDate:      Date;
  merchantName: string;
  currency?:    string;
  sections:     SectionKey[];
  insights:     RangeInsight[];
  kpis:         Record<string, number | null>;
  topCustomers?: CustomerSlice[];
  inflows?:      CashFlowBucket[];
  outflows?:     CashFlowBucket[];
  taxItems?:     TaxItem[];
}

export function renderRangeReportTemplate(args: {
  data:   RangeReportData;
  theme:  Theme;
  locale: Locale;
}): string {
  const pal      = paletteOf(args.theme);
  const data     = args.data;
  const currency = data.currency || 'TRY';
  const sym      = currency === 'TRY' ? '₺' : currency === 'SAR' ? 'SAR ' : '';
  const fmtCur   = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;

  const includes = (s: SectionKey) => data.sections.includes(s);

  const cover            = renderCoverPage(data, args.locale);
  const summary          = renderExecutiveSummary({ data, theme: args.theme, locale: args.locale, fmtCur });
  const insightsSection  = includes('insights') ? renderInsightsSection({ data, theme: args.theme, locale: args.locale }) : '';
  const customersSection = includes('customers') && data.topCustomers?.length ? renderCustomersSection({ data, theme: args.theme, locale: args.locale, fmtCur }) : '';
  const cashSection      = includes('cashflow') && (data.inflows?.length || data.outflows?.length) ? renderCashSection({ data, theme: args.theme, locale: args.locale, fmtCur }) : '';
  const taxSection       = includes('taxes') && data.taxItems?.length ? renderTaxSection({ data, theme: args.theme, locale: args.locale, fmtCur }) : '';
  const finalPage        = renderFinalPage({ data, theme: args.theme, locale: args.locale });

  const body = [cover, summary, insightsSection, customersSection, cashSection, taxSection, finalPage]
    .filter(Boolean)
    .join('');

  return htmlShell({
    title:  `${t('rangeTitle', args.locale)} — ${data.merchantName} — ${formatDate(data.startDate, args.locale)}–${formatDate(data.endDate, args.locale)}`,
    theme:  args.theme,
    locale: args.locale,
    body,
    extraStyle: `
      .cover-page {
        position: relative;
        height: 265mm;
        overflow: hidden;
        border-radius: 6pt;
        page-break-after: always;
        background: #0A0E27;
        color: #F8FAFC;
      }
      .section-page { page-break-before: always; padding-top: 8pt; }
      .section-title-row {
        display: flex; align-items: center; justify-content: space-between;
        padding-bottom: 10pt; border-bottom: 1px solid ${pal.border};
        margin-bottom: 16pt;
      }
    `
  });
}

// ─── Page builders ────────────────────────────────────────────

function renderCoverPage(data: RangeReportData, locale: Locale): string {
  return `
    <div class="cover-page">
      ${coverBackground()}
      <div style="position: relative; z-index: 1; padding: 32pt; height: 100%;
                  display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: inline-flex; align-items: center; gap: 6pt;
                      padding: 6pt 12pt;
                      background: rgba(0, 217, 255, 0.10);
                      border: 1px solid rgba(0, 217, 255, 0.40);
                      border-radius: 99pt;
                      color: #5DFAFF;
                      font-size: 8pt; font-weight: 700; letter-spacing: 0.10em;
                      text-transform: uppercase;">
            <span style="display: inline-block; width: 5pt; height: 5pt; border-radius: 50%;
                         background: #5DFAFF; box-shadow: 0 0 4pt #00D9FF;"></span>
            Zyrix FinSuite · AI Co-Pilot
          </div>
          <div style="margin-top: 20pt; font-size: 38pt; font-weight: 700; line-height: 1.05;
                      letter-spacing: -0.03em;">${esc(t('rangeTitle', locale))}</div>
          <div style="margin-top: 12pt; font-size: 14pt; color: #CBD5E1; font-weight: 500;">
            ${esc(t('forMerchant', locale))} ${esc(data.merchantName)}
          </div>
          <div style="margin-top: 32pt; font-size: 11pt; color: #CBD5E1; letter-spacing: 0.04em;">
            <div style="font-size: 9pt; color: #64748B; text-transform: uppercase; letter-spacing: 0.10em; font-weight: 700;">
              ${esc(t('dateRange', locale))}
            </div>
            <div style="margin-top: 4pt; font-size: 16pt; color: #F8FAFC; font-weight: 600;">
              ${esc(formatDate(data.startDate, locale))} — ${esc(formatDate(data.endDate, locale))}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 14pt; font-weight: 700; color: #F8FAFC;
                      text-shadow: 0 0 8pt rgba(0, 217, 255, 0.5);">
            Zyrix <span style="color: #00D9FF;">FinSuite</span>
          </div>
          <div style="font-size: 8pt; color: #64748B; letter-spacing: 0.06em;">
            ${esc(t('generatedBy', locale))}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderExecutiveSummary(args: {
  data:   RangeReportData;
  theme:  Theme;
  locale: Locale;
  fmtCur: (n: number) => string;
}): string {
  const pal = paletteOf(args.theme);
  const days = Math.max(1, Math.round((args.data.endDate.getTime() - args.data.startDate.getTime()) / 86400000));
  const insightCount = args.data.insights.length;
  const fmtNum = (n: number) => Math.round(n).toLocaleString();
  const fmtPct = (n: number) => `${n.toFixed(0)}%`;
  const fmtDays = (n: number) => `${Math.round(n)}d`;

  const candidates: Array<[string, any, any, (n: number) => string]> = [
    ['mrr',                args.data.kpis.mrr,                'cyan',    args.fmtCur],
    ['cashBalance',        args.data.kpis.cash_balance,       'mint',    args.fmtCur],
    ['cashRunwayDays',     args.data.kpis.cash_runway_days,   'mint',    fmtDays],
    ['overdueReceivables', args.data.kpis.overdue_receivables, 'amber',   args.fmtCur],
    ['taxBurden',          args.data.kpis.tax_burden,         'crimson', args.fmtCur],
    ['customerHealthPct',  args.data.kpis.customer_health_pct, 'violet',  fmtPct],
    ['pendingInvoices',    args.data.kpis.pending_invoices,   'cyan',    fmtNum],
    ['newCustomers30d',    args.data.kpis.new_customers_30d,  'mint',    fmtNum]
  ];
  const kpiArray = candidates
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .slice(0, 4)
    .map(([key, v, tone, format]) => ({ label: t(key as any, args.locale), value: v as number, tone, format }));

  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('executiveSummary', args.locale))}</div>
        </div>
        <div style="text-align: ${args.locale === 'ar' ? 'left' : 'right'};">
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('dateRange', args.locale))}</div>
          <div class="t-heading-md t-dim" style="margin-top: 4pt;">
            ${esc(formatDate(args.data.startDate, args.locale))} — ${esc(formatDate(args.data.endDate, args.locale))}
          </div>
        </div>
      </div>

      <div class="t-body-lg t-dim mb-4" style="line-height: 1.6;">
        ${esc(args.data.merchantName)} —
        ${insightCount} ${esc(t('insights', args.locale))} · ${days} ${args.locale === 'tr' ? 'gün' : args.locale === 'ar' ? 'يوم' : 'days'}.
      </div>

      <div class="page-break-avoid mb-4">
        <div class="t-caption mb-3">${esc(t('keyMetrics', args.locale))}</div>
        ${constellationKpiGrid({ kpis: kpiArray, theme: args.theme })}
      </div>

      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}

function renderInsightsSection(args: { data: RangeReportData; theme: Theme; locale: Locale; }): string {
  const pal = paletteOf(args.theme);
  if (!args.data.insights.length) return '';

  // Group by date (YYYY-MM-DD).
  const groups = new Map<string, RangeInsight[]>();
  for (const ins of args.data.insights) {
    const key = ins.generatedAt.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ins);
  }
  // Sort groups DESC by date, then severity within each.
  const orderedKeys = [...groups.keys()].sort().reverse();
  const sevOrder = { CRITICAL: 0, ATTENTION: 1, OPPORTUNITY: 2 };

  const groupsHtml = orderedKeys.map((dateKey) => {
    const items = groups.get(dateKey)!.sort((a, b) => sevOrder[a.type] - sevOrder[b.type]);
    return `
      <div class="page-break-avoid" style="margin-bottom: 18pt;">
        <div class="t-caption" style="color: ${pal.textFaint}; margin-bottom: 8pt;">
          ${esc(formatDate(new Date(dateKey + 'T00:00:00Z'), args.locale))}
        </div>
        ${items.map((ins) => `
          <div style="margin-bottom: 8pt;">
            ${aiInsightCard({
              severity:    ins.type.toLowerCase() as any,
              title:       ins.title,
              description: ins.body,
              actionLabel: ins.ctaLabel,
              badgeText:   t(ins.type.toLowerCase() as any, args.locale),
              theme:       args.theme
            })}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('insights', args.locale))}</div>
        </div>
      </div>
      ${groupsHtml}
      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}

function renderCustomersSection(args: {
  data: RangeReportData; theme: Theme; locale: Locale; fmtCur: (n: number) => string;
}): string {
  const pal = paletteOf(args.theme);
  const top = (args.data.topCustomers || []).slice(0, 6);
  if (top.length === 0) return '';
  const tones: Tone[] = ['cyan', 'violet', 'mint', 'amber', 'crimson'];

  const total = top.reduce((s, c) => s + c.value, 0);
  const rows = top.map((c, i) => {
    const tone = tones[i % tones.length];
    const fg = toneColor(tone);
    const pct = total > 0 ? (c.value / total) * 100 : 0;
    return `
      <div style="display: flex; align-items: center; gap: 12pt;
                  padding: 8pt 0; border-bottom: 1px solid ${pal.border};">
        <span style="display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; background: ${fg};
                     box-shadow: 0 0 4pt ${fg};"></span>
        <span style="flex: 1; font-size: 10pt; font-weight: 600; color: ${pal.textPrimary};">${esc(c.name)}</span>
        <span style="font-size: 11pt; font-weight: 700; color: ${pal.textPrimary};">${esc(args.fmtCur(c.value))}</span>
        <span style="font-size: 9pt; color: ${pal.textFaint}; min-width: 36pt; text-align: right;">${pct.toFixed(0)}%</span>
      </div>
    `;
  }).join('');

  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('topCustomers', args.locale))}</div>
        </div>
      </div>
      <div style="display: flex; gap: 24pt; align-items: flex-start;">
        <div style="flex-shrink: 0;">
          ${holographicDonut({
            data:        top.map((c, i) => ({ name: c.name, value: c.value, tone: tones[i % tones.length] })),
            width:       220,
            height:      220,
            thickness:   28,
            centerSub:   t('topCustomers', args.locale),
            format:      args.fmtCur,
            theme:       args.theme
          })}
        </div>
        <div style="flex: 1;">
          ${rows}
        </div>
      </div>
      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}

function renderCashSection(args: {
  data: RangeReportData; theme: Theme; locale: Locale; fmtCur: (n: number) => string;
}): string {
  const pal = paletteOf(args.theme);
  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('cashFlow', args.locale))}</div>
        </div>
      </div>
      <div class="page-break-avoid">
        ${flowStream({
          inflows:  args.data.inflows  || [],
          outflows: args.data.outflows || [],
          width:    480,
          height:   220,
          theme:    args.theme,
          format:   args.fmtCur
        })}
      </div>
      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}

function renderTaxSection(args: {
  data: RangeReportData; theme: Theme; locale: Locale; fmtCur: (n: number) => string;
}): string {
  const pal = paletteOf(args.theme);
  const items = (args.data.taxItems || []).slice(0, 12);

  const rows = items.map((it) => {
    const tone: Tone = it.isSubmitted ? 'mint' : 'amber';
    const fg = toneColor(tone);
    return `
      <div style="display: flex; align-items: center; gap: 12pt;
                  padding: 8pt 0; border-bottom: 1px solid ${pal.border};">
        <span style="display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; background: ${fg};"></span>
        <span style="flex: 1; font-size: 10pt; font-weight: 600; color: ${pal.textPrimary};">${esc(it.title)}</span>
        <span style="font-size: 9pt; color: ${pal.textFaint}; min-width: 80pt; text-align: ${args.locale === 'ar' ? 'left' : 'right'};">
          ${esc(formatDate(it.dueDate, args.locale))}
        </span>
        <span style="font-size: 11pt; font-weight: 700; color: ${pal.textPrimary}; min-width: 80pt; text-align: ${args.locale === 'ar' ? 'left' : 'right'};">
          ${typeof it.amount === 'number' ? esc(args.fmtCur(it.amount)) : '—'}
        </span>
      </div>
    `;
  }).join('');

  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('taxTimeline', args.locale))}</div>
        </div>
      </div>
      ${rows || `<div class="card" style="text-align: center; padding: 24pt;">
        <span class="t-caption">${esc(t('noData', args.locale))}</span>
      </div>`}
      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}

function renderFinalPage(args: {
  data: RangeReportData; theme: Theme; locale: Locale;
}): string {
  const pal = paletteOf(args.theme);
  const criticalCount    = args.data.insights.filter((i) => i.type === 'CRITICAL').length;
  const attentionCount   = args.data.insights.filter((i) => i.type === 'ATTENTION').length;
  const opportunityCount = args.data.insights.filter((i) => i.type === 'OPPORTUNITY').length;

  return `
    <div class="section-page">
      <div class="section-title-row">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('rangeTitle', args.locale))}</div>
          <div class="t-display-md" style="margin-top: 4pt;">${esc(t('actionItems', args.locale))}</div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="t-heading-md mb-2" style="color: #FF3D5A;">${esc(t('critical', args.locale))} · ${criticalCount}</div>
        <div class="t-body-md t-dim">
          ${args.data.insights.filter((i) => i.type === 'CRITICAL').slice(0, 3)
            .map((i) => `· ${esc(i.title)}`).join('<br/>') || '—'}
        </div>
      </div>
      <div class="card mb-3">
        <div class="t-heading-md mb-2" style="color: #FFB800;">${esc(t('attention', args.locale))} · ${attentionCount}</div>
        <div class="t-body-md t-dim">
          ${args.data.insights.filter((i) => i.type === 'ATTENTION').slice(0, 3)
            .map((i) => `· ${esc(i.title)}`).join('<br/>') || '—'}
        </div>
      </div>
      <div class="card mb-6">
        <div class="t-heading-md mb-2" style="color: #06FFA5;">${esc(t('opportunity', args.locale))} · ${opportunityCount}</div>
        <div class="t-body-md t-dim">
          ${args.data.insights.filter((i) => i.type === 'OPPORTUNITY').slice(0, 3)
            .map((i) => `· ${esc(i.title)}`).join('<br/>') || '—'}
        </div>
      </div>

      <div style="margin-top: 24pt; padding: 16pt; border-radius: 12pt;
                  border: 1px solid rgba(0, 217, 255, 0.30);
                  background: linear-gradient(135deg, rgba(${RGB.violet}, 0.08) 0%, rgba(${RGB.cyan}, 0.06) 100%);">
        <div style="font-size: 9pt; font-weight: 700; letter-spacing: 0.10em; color: #00D9FF; text-transform: uppercase;">
          Zyrix FinSuite
        </div>
        <div class="t-heading-md mt-1" style="color: ${pal.textPrimary};">
          ${esc(t('generatedBy', args.locale))} · finsuite.zyrix.co
        </div>
      </div>

      ${footer({ merchantName: args.data.merchantName, generatedAt: new Date(), locale: args.locale })}
    </div>
  `;
}
