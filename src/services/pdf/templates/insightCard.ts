// ================================================================
// Template 1 — Single Insight Card (1-page A4 artifact).
// Header band with severity badge + glow.
// Title (display-md), body (body-lg), generated date, merchant name.
// Embedded chart (sparkline or KPI tile) if numericRefs present.
// Footer with Zyrix branding.
// ================================================================
import { htmlShell, footer, formatDate } from './_layout';
import { aiInsightCard, liquidKpiCard, pulseSparkline } from './charts';
import { t } from '../i18n';
import { paletteOf, Theme, Locale, RGB, glowOf } from '../palette';
import { esc } from '../escape';

export interface InsightTemplateData {
  type:         'CRITICAL' | 'ATTENTION' | 'OPPORTUNITY';
  title:        string;
  body:         string;
  category?:    string;
  ctaLabel?:    string;
  numericRefs?: Record<string, any>;
  language:     Locale;
  generatedAt:  Date;
  merchantName: string;
  currency?:    string;
}

export function renderInsightCardTemplate(args: {
  data:   InsightTemplateData;
  theme:  Theme;
  locale: Locale;
}): string {
  const pal      = paletteOf(args.theme);
  const data     = args.data;
  const severity = (data.type.toLowerCase() as 'critical' | 'attention' | 'opportunity');
  const badge    = t(severity, args.locale);

  // Pull a "hero number" from numericRefs if present.
  const hero = pickHeroKpi(data.numericRefs);

  const sparklineSeed = sparklineFromValue(hero?.value);

  const heroBlock = hero ? `
    <div style="margin-top: 20pt;">
      ${liquidKpiCard({
        value:  hero.value,
        label:  t((hero.key as any) || 'mrr', args.locale),
        tone:   hero.tone,
        format: hero.format,
        width:  240,
        height: 110,
        theme:  args.theme
      })}
    </div>
  ` : '';

  const sparklineBlock = sparklineSeed ? `
    <div style="margin-top: 14pt; opacity: 0.85;">
      ${pulseSparkline({ data: sparklineSeed, severity: severity === 'critical' ? 'critical' : severity === 'attention' ? 'warning' : 'normal', width: 280, height: 36, theme: args.theme })}
    </div>
  ` : '';

  // Insight header card — uses our styled aiInsightCard helper (without action; we render label below)
  const insightBlock = aiInsightCard({
    severity,
    title:       data.title,
    description: data.body,
    actionLabel: data.ctaLabel,
    badgeText:   badge,
    theme:       args.theme
  });

  const body = `
    <div style="display: flex; flex-direction: column; min-height: 235mm;">
      <!-- Top brand strip -->
      <div style="display: flex; justify-content: space-between; align-items: center;
                  margin-bottom: 18pt; padding-bottom: 14pt; border-bottom: 1px solid ${pal.border};">
        <div>
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('insightTitle', args.locale))}</div>
          <div style="font-size: 11pt; font-weight: 700; color: ${pal.textPrimary}; margin-top: 2pt;">
            ${esc(data.merchantName)}
          </div>
        </div>
        <div style="text-align: ${args.locale === 'ar' ? 'left' : 'right'};">
          <div class="t-caption" style="color: ${pal.textFaint};">${esc(t('generated', args.locale))}</div>
          <div style="font-size: 10pt; font-weight: 600; color: ${pal.textDim}; margin-top: 2pt;">
            ${esc(formatDate(data.generatedAt, args.locale))}
          </div>
        </div>
      </div>

      <!-- Insight card -->
      <div style="margin-bottom: 24pt;">
        ${insightBlock}
      </div>

      ${heroBlock}
      ${sparklineBlock}

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
        generatedAt:  data.generatedAt,
        locale:       args.locale
      })}
    </div>
  `;

  return htmlShell({
    title:  `${t('insightTitle', args.locale)} — ${data.title.slice(0, 50)}`,
    theme:  args.theme,
    locale: args.locale,
    body
  });
}

// ─── Helpers ────────────────────────────────────────────────

function pickHeroKpi(refs: any): { key: string; value: number; tone: any; format: (n: number) => string } | null {
  if (!refs) return null;
  const currency = refs.currency || 'TRY';
  const sym = currency === 'TRY' ? '₺' : currency === 'SAR' ? 'SAR ' : currency === 'USD' ? '$' : '';
  const fmtCur = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;
  const fmtNum = (n: number) => Math.round(n).toLocaleString();

  // Priority order: mrr > cash_balance > overdue_receivables > tax_burden > top_customer_revenue
  const candidates: Array<[string, any, (n: number) => string]> = [
    ['mrr',                refs.mrr,                fmtCur],
    ['cashBalance',        refs.cash_balance,       fmtCur],
    ['overdueReceivables', refs.overdue_receivables, fmtCur],
    ['taxBurden',          refs.tax_burden,         fmtCur],
    ['topCustomerRevenue', refs.top_customer_revenue, fmtCur],
    ['cashRunwayDays',     refs.cash_runway_days,   fmtNum],
    ['customerHealthPct',  refs.customer_health_pct, (n: number) => `${n.toFixed(0)}%`]
  ];

  for (const [key, value, format] of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const tone = key === 'overdueReceivables' || key === 'taxBurden' ? 'amber'
                 : key === 'mrr' || key === 'topCustomerRevenue' ? 'cyan'
                 : key === 'cashBalance' || key === 'cashRunwayDays' ? 'mint'
                 : 'violet';
      return { key, value, tone, format };
    }
  }
  return null;
}

function sparklineFromValue(v: number | undefined): number[] | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // Synthesize a small fake trend around the value for visual context only.
  // Real per-KPI history is out of scope for D-2 (Insight rows don't store trend arrays).
  const base = Math.abs(v) || 1;
  const noise = base * 0.10;
  return Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    const ease = 0.85 + t * 0.20;
    const wobble = Math.sin(i * 1.2) * noise * 0.3;
    return base * ease + wobble;
  });
}
