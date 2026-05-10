// ================================================================
// Sprint D-6 — On-demand PDF rendering for a persisted WeeklyReport
// row.
//
// Per decision §6.B (option B1 — no blob storage in V1), the row
// stores narrative + KPI snapshot + insightIds; the PDF is rebuilt
// from these inputs every time someone needs the bytes (email
// dispatch, dashboard download, share). Since the row is the
// single source of truth, output is deterministic.
//
// Used by:
//   - sendWeeklyReport.ts (email attachment)
//   - customer/weeklyReportController.ts (download + view endpoints)
// ================================================================
import { prisma } from "../../config/database";
import { renderPdf } from "../pdf/pdfRenderer";
import { renderWeeklyReportTemplate, WeeklyReportTemplateData, WeeklyInsight } from "../pdf/templates/weeklyReport";
import type { WeeklySnapshot } from "./weeklyKpis";

import type { Theme } from "../pdf/palette";

export interface RenderReportPdfArgs {
  reportId: string;
  theme?:   Theme;
}

export interface RenderReportPdfResult {
  buffer:   Buffer;
  filename: string;
  reportId: string;
  language: string;
}

const ALLOWED_TYPES = new Set(["CRITICAL", "ATTENTION", "OPPORTUNITY"]);

export async function renderReportPdf(args: RenderReportPdfArgs): Promise<RenderReportPdfResult> {
  const report = await prisma.weeklyReport.findUnique({
    where:   { id: args.reportId },
    include: {
      merchant: { select: { name: true, businessName: true } }
    }
  });
  if (!report) {
    throw new Error(`weekly_report_not_found: ${args.reportId}`);
  }

  // Fetch insights referenced by the row (best-effort; missing rows
  // simply collapse the action-items page to its empty state).
  let insights: WeeklyInsight[] = [];
  if (report.insightIds.length > 0) {
    const rows = await prisma.insight.findMany({
      where:  { id: { in: report.insightIds } },
      select: { id: true, type: true, title: true, body: true, ctaLabel: true }
    }).catch(() => []);
    // Preserve the ordering captured at generation time.
    const byId = new Map<string, typeof rows[number]>();
    for (const r of rows) byId.set(r.id, r);
    for (const id of report.insightIds) {
      const r = byId.get(id);
      if (!r) continue;
      const t = String(r.type);
      insights.push({
        type:      ALLOWED_TYPES.has(t) ? (t as any) : "ATTENTION",
        title:     r.title,
        body:      r.body,
        ctaLabel:  r.ctaLabel || undefined
      });
    }
  }

  const merchantName = report.merchant.businessName || report.merchant.name || "—";
  const language    = (report.language as "tr" | "en" | "ar") || "tr";
  const snapshot    = report.kpiSnapshot as unknown as WeeklySnapshot;

  const data: WeeklyReportTemplateData = {
    weekStart: report.weekStart,
    weekEnd:   report.weekEnd,
    merchantName,
    narrative: report.narrative,
    snapshot:  snapshot as any,
    insights
  };

  const html = renderWeeklyReportTemplate({
    data,
    theme:  args.theme || "print",
    locale: language
  });

  const buffer = await renderPdf({
    html,
    metadata: {
      title:    `Zyrix Weekly Report — ${merchantName}`,
      author:   "Zyrix FinSuite",
      subject:  `Weekly Performance ${snapshot.weekStart}–${snapshot.weekEnd}`,
      creator:  "Zyrix AI Co-Pilot",
      producer: "Zyrix FinSuite"
    }
  });

  const filename = `zyrix-weekly-${snapshot.weekStart}.pdf`;

  return { buffer, filename, reportId: report.id, language };
}
