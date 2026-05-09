// ================================================================
// publicShareController.ts — Sprint D-3.
//   GET /share/:token
//
// Public, NOT auth-protected. Security model:
//   1. Token is a JWT signed with env.jwtSecret + issuer scoping
//      ('zyrix-finsuite-d3-share').
//   2. Token expiry is 7 days from share creation.
//   3. Decoded {shareId, merchantId} cross-checked against the
//      InsightShare row. Mismatch ⇒ 404.
//   4. Each successful download increments InsightShare.downloadCount
//      and stamps firstDownloadedAt (atomic update).
//
// PDF is regenerated from the live Insight / brief / range params on
// demand — no persistent storage. If D-2 PDF rendering is currently
// blocked, this endpoint returns 503; the share record is still
// readable, the link still resolves once the runtime is fixed.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../config/database";
import { verifyShareToken } from "../services/sharing/shareToken";
import { renderPdf } from "../services/pdf/pdfRenderer";
import { renderInsightCardTemplate } from "../services/pdf/templates/insightCard";
import { renderDailyBriefTemplate, DailyBriefCard } from "../services/pdf/templates/dailyBrief";
import { renderRangeReportTemplate, RangeReportData, SectionKey, RangeInsight }
  from "../services/pdf/templates/rangeReport";
import { Theme, Locale } from "../services/pdf/palette";
import { t as pdfT } from "../services/pdf/i18n";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

function slug(s: string): string {
  return String(s || "merchant").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "merchant";
}

export const publicShareController = {
  // GET /share/:token
  getPdf: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const token = String(req.params.token || "");
    if (!token) {
      res.status(404).type("text/plain").send("Share link not found.");
      return;
    }

    let payload: { shareId: string; merchantId: string };
    try {
      payload = verifyShareToken(token);
    } catch {
      res.status(410).type("text/plain").send("Share link is invalid or has expired.");
      return;
    }

    try {
      const share = await prisma.insightShare.findUnique({
        where: { id: payload.shareId }
      });
      if (!share) {
        res.status(404).type("text/plain").send("Share link not found.");
        return;
      }
      if (share.merchantId !== payload.merchantId) {
        // Token was signed for a different merchant — never serve.
        res.status(404).type("text/plain").send("Share link not found.");
        return;
      }
      if (share.pdfShareToken && share.pdfShareToken !== token) {
        // Token has been rotated/invalidated.
        res.status(410).type("text/plain").send("Share link is no longer valid.");
        return;
      }

      // Reconstruct the render request from the snapshot saved at share time.
      const snap = (share.recipientSnapshot as any) || {};
      const locale: Locale = (snap.locale === "ar" || snap.locale === "en" || snap.locale === "tr") ? snap.locale : "tr";
      const theme:  Theme  = snap.theme === "print" ? "print" : "digital";

      const merchant = await prisma.merchant.findUnique({
        where:  { id: share.merchantId },
        select: { name: true, businessName: true, currency: true }
      });
      if (!merchant) {
        res.status(404).type("text/plain").send("Share link not found.");
        return;
      }
      const merchantName = merchant.businessName || merchant.name || "";
      const slugMerchant = slug(merchantName);

      let pdfBuffer: Buffer;
      let filename:  string;

      if (share.reportType === "single_insight") {
        if (!share.insightId) { res.status(404).type("text/plain").send("Insight no longer exists."); return; }
        const insight = await prisma.insight.findFirst({
          where: { id: share.insightId, merchantId: share.merchantId }
        });
        if (!insight) { res.status(404).type("text/plain").send("Insight no longer exists."); return; }

        const html = renderInsightCardTemplate({
          data: {
            type:        insight.type as any,
            title:       insight.title,
            body:        insight.body,
            category:    insight.category,
            ctaLabel:    insight.ctaLabel || undefined,
            numericRefs: (insight.numericRefs as any) || undefined,
            language:    locale,
            generatedAt: insight.generatedAt,
            merchantName,
            currency:    merchant.currency || undefined
          },
          theme, locale
        });
        pdfBuffer = await renderPdf({
          html,
          metadata: {
            title:    `${pdfT("insightTitle", locale)} — ${insight.title.slice(0, 80)}`,
            author:   merchantName,
            subject:  pdfT("generatedBy", locale),
            creator:  "Zyrix",
            producer: "Zyrix FinSuite"
          }
        });
        filename = `zyrix-insight-${slugMerchant}-${insight.generatedAt.toISOString().slice(0, 10)}.pdf`;
      } else if (share.reportType === "daily_brief") {
        const rp = snap.reportParams || {};
        const dateStr = rp.date && /^\d{4}-\d{2}-\d{2}$/.test(rp.date) ? rp.date : new Date().toISOString().slice(0, 10);
        const briefDate = new Date(dateStr + "T00:00:00Z");
        const brief = await prisma.customerDailyBrief.findFirst({
          where: { customerUserId: share.merchantId, briefDate }
        });
        if (!brief) { res.status(404).type("text/plain").send("Daily brief no longer exists."); return; }

        const cards: DailyBriefCard[] = [];
        const c = brief.criticalCard as any, a = brief.attentionCard as any, o = brief.opportunityCard as any;
        if (c?.title) cards.push({ type: "CRITICAL",    title: c.title, body: c.description || "", ctaLabel: c.actionLabel });
        if (a?.title) cards.push({ type: "ATTENTION",   title: a.title, body: a.description || "", ctaLabel: a.actionLabel });
        if (o?.title) cards.push({ type: "OPPORTUNITY", title: o.title, body: o.description || "", ctaLabel: o.actionLabel });

        const recent = await prisma.insight.findFirst({
          where:   { merchantId: share.merchantId, generatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          orderBy: { generatedAt: "desc" }
        });
        const kpis = (recent?.numericRefs as any) || {};

        const html = renderDailyBriefTemplate({
          data: { date: briefDate, merchantName, cards, kpis, currency: merchant.currency || undefined },
          theme, locale
        });
        pdfBuffer = await renderPdf({
          html,
          metadata: {
            title:    `${pdfT("dailyBriefTitle", locale)} — ${merchantName} — ${dateStr}`,
            author:   merchantName,
            subject:  pdfT("generatedBy", locale),
            creator:  "Zyrix",
            producer: "Zyrix FinSuite"
          }
        });
        filename = `zyrix-daily-brief-${slugMerchant}-${dateStr}.pdf`;
      } else if (share.reportType === "range_report") {
        const rp = snap.reportParams || {};
        if (!rp.startDate || !rp.endDate
            || !/^\d{4}-\d{2}-\d{2}$/.test(rp.startDate)
            || !/^\d{4}-\d{2}-\d{2}$/.test(rp.endDate)) {
          res.status(404).type("text/plain").send("Range report parameters missing."); return;
        }
        const startDate = new Date(rp.startDate + "T00:00:00Z");
        const endDate   = new Date(rp.endDate   + "T23:59:59Z");
        const sectionsAllowed: SectionKey[] = ["insights", "kpis", "customers", "taxes", "cashflow"];
        const sections: SectionKey[] = (rp.sections || ["insights", "kpis"])
          .map((s: any) => String(s).toLowerCase())
          .filter((s: string) => sectionsAllowed.includes(s as SectionKey)) as SectionKey[];

        const insightsRaw = await prisma.insight.findMany({
          where:   { merchantId: share.merchantId, generatedAt: { gte: startDate, lte: endDate }, status: { not: "ARCHIVED" as any } },
          orderBy: { generatedAt: "desc" },
          take:    200
        });
        const insights: RangeInsight[] = insightsRaw.map((i) => ({
          type:        i.type as any,
          title:       i.title,
          body:        i.body,
          ctaLabel:    i.ctaLabel || undefined,
          generatedAt: i.generatedAt
        }));
        const kpis = (insightsRaw[0]?.numericRefs as any) || {};
        const data: RangeReportData = {
          startDate, endDate, merchantName,
          currency: merchant.currency || undefined,
          sections, insights, kpis
        };
        const html = renderRangeReportTemplate({ data, theme, locale });
        pdfBuffer = await renderPdf({
          html,
          metadata: {
            title:    `${pdfT("rangeTitle", locale)} — ${merchantName} — ${rp.startDate}_${rp.endDate}`,
            author:   merchantName,
            subject:  pdfT("generatedBy", locale),
            creator:  "Zyrix",
            producer: "Zyrix FinSuite"
          }
        });
        filename = `zyrix-range-report-${slugMerchant}-${rp.startDate}_${rp.endDate}.pdf`;
      } else {
        res.status(404).type("text/plain").send("Unknown share type."); return;
      }

      // Stamp download tracking (best-effort, never blocks the stream).
      prisma.insightShare.update({
        where: { id: share.id },
        data: {
          downloadCount: { increment: 1 },
          firstDownloadedAt: share.firstDownloadedAt ?? new Date()
        }
      }).catch(() => undefined);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdfBuffer.length));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.end(pdfBuffer);
    } catch (err: any) {
      console.error("[share/getPdf] error:", err?.message || err);
      // Render failures usually mean D-2 runtime block — return 503 so
      // the recipient understands it's a temporary issue.
      res.status(503).type("text/plain").send(
        "PDF rendering is temporarily unavailable. Please try again later."
      );
    }
  })
};
