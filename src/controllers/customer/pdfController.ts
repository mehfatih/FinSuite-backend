// ================================================================
// Customer PDF generation controller (Sprint D-2).
//   POST /api/customer/pdf/insight/:insightId
//   POST /api/customer/pdf/daily-brief
//   POST /api/customer/pdf/range-report
//
// Shared rate limit: 10 PDFs / merchant / hour across all endpoints.
// JWT auth required (`authenticate` middleware in routes).
// All merchant scoping enforced via req.merchant.id; client never trusted.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { renderPdf } from "../../services/pdf/pdfRenderer";
import { renderInsightCardTemplate } from "../../services/pdf/templates/insightCard";
import { renderDailyBriefTemplate, DailyBriefCard } from "../../services/pdf/templates/dailyBrief";
import { renderRangeReportTemplate, RangeReportData, SectionKey, RangeInsight } from "../../services/pdf/templates/rangeReport";
import { Theme, Locale } from "../../services/pdf/palette";
import { t } from "../../services/pdf/i18n";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ─── Shared rate limit (10 / merchant / hour) ─────────────────
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT     = 10;
const rateBuckets    = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(merchantId: string): { ok: true } | { ok: false; retryInSec: number } {
  const now = Date.now();
  const b   = rateBuckets.get(merchantId);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(merchantId, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (b.count >= RATE_LIMIT) {
    return { ok: false, retryInSec: Math.ceil((b.windowStart + RATE_WINDOW_MS - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

// ─── Helpers ──────────────────────────────────────────────────

function pickTheme(req: Request): Theme {
  const v = String((req.query.theme ?? req.body?.theme ?? 'digital')).toLowerCase();
  return v === 'print' ? 'print' : 'digital';
}
function pickLocale(req: Request, fallback: string = 'tr'): Locale {
  const v = String((req.query.locale ?? req.body?.locale ?? fallback)).toLowerCase();
  return (v === 'ar' || v === 'en' || v === 'tr') ? v : 'tr';
}

function slug(s: string): string {
  return String(s || 'merchant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'merchant';
}

function send(res: Response, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(pdf);
}

const PRODUCER = 'Zyrix FinSuite';
const CREATOR  = 'Zyrix';

// ─── Handlers ─────────────────────────────────────────────────

export const pdfController = {

  // POST /api/customer/pdf/insight/:insightId
  insight: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: 'Auth required.' }); return; }

      const limit = checkRateLimit(userId);
      if (limit.ok === false) {
        res.status(429).json({ success: false, error: 'Rate limit reached.', retryInSec: limit.retryInSec });
        return;
      }

      const insightId = String(req.params.insightId || '');
      if (!insightId) { res.status(400).json({ success: false, error: 'Missing insight id.' }); return; }

      const [insight, merchant] = await Promise.all([
        prisma.insight.findFirst({ where: { id: insightId, merchantId: userId } }),
        prisma.merchant.findUnique({ where: { id: userId }, select: { name: true, businessName: true, currency: true } })
      ]);

      if (!insight) { res.status(404).json({ success: false, error: 'Insight not found.' }); return; }
      if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found.' }); return; }

      const theme  = pickTheme(req);
      const locale = pickLocale(req, insight.language || 'tr');
      const merchantName = merchant.businessName || merchant.name || '';

      const html = renderInsightCardTemplate({
        data: {
          type:         insight.type as any,
          title:        insight.title,
          body:         insight.body,
          category:     insight.category,
          ctaLabel:     insight.ctaLabel || undefined,
          numericRefs:  (insight.numericRefs as any) || undefined,
          language:     locale,
          generatedAt:  insight.generatedAt,
          merchantName,
          currency:     merchant.currency || undefined
        },
        theme,
        locale
      });

      const pdf = await renderPdf({
        html,
        metadata: {
          title:    `${t('insightTitle', locale)} — ${insight.title.slice(0, 80)}`,
          author:   merchantName,
          subject:  t('generatedBy', locale),
          creator:  CREATOR,
          producer: PRODUCER
        }
      });

      const filename = `zyrix-insight-${slug(merchantName)}-${insight.generatedAt.toISOString().slice(0, 10)}.pdf`;
      send(res, pdf, filename);
    } catch (err: any) {
      console.error('[pdf/insight] error:', err?.message || err);
      res.status(500).json({ success: false, error: 'Failed to render insight PDF.' });
    }
  }),

  // POST /api/customer/pdf/daily-brief
  dailyBrief: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: 'Auth required.' }); return; }

      const limit = checkRateLimit(userId);
      if (limit.ok === false) {
        res.status(429).json({ success: false, error: 'Rate limit reached.', retryInSec: limit.retryInSec });
        return;
      }

      const dateParam = String(req.query.date ?? req.body?.date ?? '');
      const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? new Date(dateParam + 'T00:00:00Z')
        : new Date();
      // Snap to day-start in UTC for the briefDate column
      const briefDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

      const [merchant, brief] = await Promise.all([
        prisma.merchant.findUnique({ where: { id: userId }, select: { name: true, businessName: true, currency: true, language: true } }),
        prisma.customerDailyBrief.findFirst({ where: { customerUserId: userId, briefDate } })
      ]);

      if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found.' }); return; }
      if (!brief)    { res.status(404).json({ success: false, error: 'No brief for that date.' }); return; }

      const theme  = pickTheme(req);
      const locale = pickLocale(req, (merchant.language || 'TR').toLowerCase());
      const merchantName = merchant.businessName || merchant.name || '';

      const cards: DailyBriefCard[] = [];
      const cc = brief.criticalCard    as any;
      const ac = brief.attentionCard   as any;
      const oc = brief.opportunityCard as any;
      if (cc?.title) cards.push({ type: 'CRITICAL',    title: cc.title, body: cc.description || '', ctaLabel: cc.actionLabel });
      if (ac?.title) cards.push({ type: 'ATTENTION',   title: ac.title, body: ac.description || '', ctaLabel: ac.actionLabel });
      if (oc?.title) cards.push({ type: 'OPPORTUNITY', title: oc.title, body: oc.description || '', ctaLabel: oc.actionLabel });

      // KPIs from the most-recent insight's numericRefs (fallback to empty)
      const recent = await prisma.insight.findFirst({
        where:   { merchantId: userId, generatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { generatedAt: 'desc' }
      });
      const kpis = (recent?.numericRefs as any) || {};

      const html = renderDailyBriefTemplate({
        data: {
          date:         briefDate,
          merchantName,
          cards,
          kpis,
          currency:     merchant.currency || undefined
        },
        theme,
        locale
      });

      const pdf = await renderPdf({
        html,
        metadata: {
          title:    `${t('dailyBriefTitle', locale)} — ${merchantName} — ${briefDate.toISOString().slice(0, 10)}`,
          author:   merchantName,
          subject:  t('generatedBy', locale),
          creator:  CREATOR,
          producer: PRODUCER
        }
      });

      const filename = `zyrix-daily-brief-${slug(merchantName)}-${briefDate.toISOString().slice(0, 10)}.pdf`;
      send(res, pdf, filename);
    } catch (err: any) {
      console.error('[pdf/daily-brief] error:', err?.message || err);
      res.status(500).json({ success: false, error: 'Failed to render daily brief PDF.' });
    }
  }),

  // POST /api/customer/pdf/range-report
  rangeReport: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: 'Auth required.' }); return; }

      const limit = checkRateLimit(userId);
      if (limit.ok === false) {
        res.status(429).json({ success: false, error: 'Rate limit reached.', retryInSec: limit.retryInSec });
        return;
      }

      const startStr = String(req.body?.startDate || '');
      const endStr   = String(req.body?.endDate   || '');
      const sectionsRaw = Array.isArray(req.body?.sections) ? req.body.sections : ['insights', 'kpis'];

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
        res.status(400).json({ success: false, error: 'startDate / endDate must be YYYY-MM-DD.' });
        return;
      }
      const startDate = new Date(startStr + 'T00:00:00Z');
      const endDate   = new Date(endStr   + 'T23:59:59Z');
      if (startDate > endDate) { res.status(400).json({ success: false, error: 'Invalid range.' }); return; }
      const days = (endDate.getTime() - startDate.getTime()) / 86400000;
      if (days > 90) { res.status(400).json({ success: false, error: 'Maximum range is 90 days.' }); return; }

      const allowed: SectionKey[] = ['insights', 'kpis', 'customers', 'taxes', 'cashflow'];
      const sections: SectionKey[] = sectionsRaw
        .map((s: any) => String(s || '').toLowerCase())
        .filter((s: string) => allowed.includes(s as SectionKey)) as SectionKey[];
      if (sections.length === 0) { res.status(400).json({ success: false, error: 'sections cannot be empty.' }); return; }

      const merchant = await prisma.merchant.findUnique({
        where:  { id: userId },
        select: { name: true, businessName: true, currency: true, language: true }
      });
      if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found.' }); return; }

      const insightsRaw = await prisma.insight.findMany({
        where: {
          merchantId: userId,
          generatedAt: { gte: startDate, lte: endDate },
          status: { not: 'ARCHIVED' as any }
        },
        orderBy: { generatedAt: 'desc' },
        take: 200
      });

      const insights: RangeInsight[] = insightsRaw.map((i) => ({
        type:        i.type as any,
        title:       i.title,
        body:        i.body,
        ctaLabel:    i.ctaLabel || undefined,
        generatedAt: i.generatedAt
      }));

      // KPIs: pull from the latest insight's numericRefs (representative snapshot).
      const kpis = (insightsRaw[0]?.numericRefs as any) || {};

      // Customers (top by revenue inside range — best-effort).
      let topCustomers: Array<{ name: string; value: number }> | undefined;
      if (sections.includes('customers')) {
        const grouped = await prisma.invoice.groupBy({
          by: ['customerName'],
          _sum: { total: true },
          where: {
            merchantId: userId,
            status: 'PAID',
            paidDate: { gte: startDate, lte: endDate }
          },
          orderBy: { _sum: { total: 'desc' } },
          take: 6
        }).catch(() => [] as any[]);
        topCustomers = grouped
          .filter((g: any) => g._sum?.total)
          .map((g: any) => ({ name: g.customerName || '—', value: Number(g._sum.total) || 0 }));
      }

      // Cashflow: aggregate bank IN/OUT and Expense categories.
      let inflows: Array<{ name: string; value: number }> | undefined;
      let outflows: Array<{ name: string; value: number }> | undefined;
      if (sections.includes('cashflow')) {
        const [inAgg, outByCat] = await Promise.all([
          prisma.bankTransaction.aggregate({
            _sum: { amount: true },
            where: { merchantId: userId, direction: 'IN', transactionDate: { gte: startDate, lte: endDate } }
          }),
          prisma.expense.groupBy({
            by: ['category'],
            _sum: { amount: true },
            where: { merchantId: userId, date: { gte: startDate, lte: endDate } },
            orderBy: { _sum: { amount: 'desc' } },
            take: 4
          }).catch(() => [] as any[])
        ]);
        const inTotal = Number((inAgg._sum as any)?.amount) || 0;
        inflows = inTotal > 0 ? [{ name: 'Income', value: inTotal }] : [];
        outflows = (outByCat || [])
          .filter((g: any) => g._sum?.amount)
          .map((g: any) => ({ name: g.category || '—', value: Number(g._sum.amount) || 0 }));
      }

      // Taxes: TaxEvents in range.
      let taxItems: Array<{ title: string; dueDate: Date; amount?: number; isSubmitted: boolean }> | undefined;
      if (sections.includes('taxes')) {
        const evs = await prisma.taxEvent.findMany({
          where: { merchantId: userId, dueDate: { gte: startDate, lte: endDate } },
          orderBy: { dueDate: 'asc' },
          take: 12,
          select: { title: true, dueDate: true, amount: true, isSubmitted: true }
        }).catch(() => [] as any[]);
        taxItems = evs.map((e: any) => ({
          title: e.title || '—',
          dueDate: e.dueDate,
          amount: e.amount ? Number(e.amount) : undefined,
          isSubmitted: !!e.isSubmitted
        }));
      }

      const theme  = pickTheme(req);
      const locale = pickLocale(req, (merchant.language || 'TR').toLowerCase());
      const merchantName = merchant.businessName || merchant.name || '';

      const data: RangeReportData = {
        startDate, endDate,
        merchantName,
        currency: merchant.currency || undefined,
        sections,
        insights,
        kpis,
        topCustomers,
        inflows,
        outflows,
        taxItems
      };

      const html = renderRangeReportTemplate({ data, theme, locale });

      const pdf = await renderPdf({
        html,
        metadata: {
          title:    `${t('rangeTitle', locale)} — ${merchantName} — ${startStr}_${endStr}`,
          author:   merchantName,
          subject:  t('generatedBy', locale),
          creator:  CREATOR,
          producer: PRODUCER
        }
      });

      const filename = `zyrix-range-report-${slug(merchantName)}-${startStr}_${endStr}.pdf`;
      send(res, pdf, filename);
    } catch (err: any) {
      console.error('[pdf/range-report] error:', err?.message || err);
      res.status(500).json({ success: false, error: 'Failed to render range report PDF.' });
    }
  })
};
