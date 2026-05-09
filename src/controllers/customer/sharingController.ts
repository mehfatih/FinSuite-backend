// ================================================================
// sharingController.ts — Sprint D-3.
//   POST /api/customer/share/email
//   POST /api/customer/share/whatsapp
//   GET  /api/customer/shares/history
//
// Behavior:
//   - Loads the source document (single insight | daily brief | range
//     report) and renders it via the D-2 PDF service.
//   - Email path (option δ): inline base64 attachment via Resend.
//   - WhatsApp path (option γ): builds wa.me URL with public
//     /share/:token link (signed JWT, 7-day expiry); recipient taps
//     the link → publicShareController regenerates the PDF on demand.
//
// Both endpoints share a 20/hour/merchant rate limit, identical
// pattern to D-2's pdfController.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { renderPdf } from "../../services/pdf/pdfRenderer";
import { renderInsightCardTemplate } from "../../services/pdf/templates/insightCard";
import { renderDailyBriefTemplate, DailyBriefCard } from "../../services/pdf/templates/dailyBrief";
import { renderRangeReportTemplate, RangeReportData, SectionKey, RangeInsight }
  from "../../services/pdf/templates/rangeReport";
import { Theme, Locale } from "../../services/pdf/palette";
import { t as pdfT } from "../../services/pdf/i18n";
import { signShareToken } from "../../services/sharing/shareToken";
import { e164, isValidE164 } from "../../services/sharing/phone";
import { sendShareEmail } from "../../services/sharing/sendShareEmail";
import { buildWaShareLink } from "../../services/sharing/waLink";
import { emitShareEvent } from "../../services/sharing/shareEvents";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ─── Shared rate limit (20 / merchant / hour, all share endpoints) ──
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT     = 20;
const buckets        = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(merchantId: string): { ok: true } | { ok: false; retryInSec: number } {
  const now = Date.now();
  const b = buckets.get(merchantId);
  if (!b || now - b.windowStart >= RATE_WINDOW_MS) {
    buckets.set(merchantId, { count: 1, windowStart: now });
    return { ok: true };
  }
  if (b.count >= RATE_LIMIT) {
    return { ok: false, retryInSec: Math.ceil((b.windowStart + RATE_WINDOW_MS - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

// ─── Public base URL for the share endpoint ────────────────────
function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL || "https://finsuite-backend-production.up.railway.app";
}

// ─── Helpers ────────────────────────────────────────────────────
function pickLocale(req: Request, fallback = "tr"): Locale {
  const v = String(req.body?.locale ?? req.query.locale ?? fallback).toLowerCase();
  return (v === "ar" || v === "en" || v === "tr") ? (v as Locale) : "tr";
}
function pickTheme(req: Request): Theme {
  const v = String(req.body?.theme ?? req.query.theme ?? "digital").toLowerCase();
  return v === "print" ? "print" : "digital";
}
function slug(s: string): string {
  return String(s || "merchant").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "merchant";
}

type ReportType = "single_insight" | "daily_brief" | "range_report";

interface SharePayload {
  reportType:   ReportType;
  insightId?:   string;
  reportParams?: {
    date?:       string;        // 'YYYY-MM-DD'
    startDate?:  string;
    endDate?:    string;
    sections?:   string[];
  };
  recipientId?: string | null;
  recipient?: {
    name:   string;
    email?: string;
    phone?: string;
    role?:  string;
  };
  customMessage?: string;
  locale:        Locale;
  theme:         Theme;
}

// ─── Render PDF for any of the 3 report types ──────────────────
async function renderForShare(args: {
  payload:     SharePayload;
  merchantId:  string;
}): Promise<{
  pdfBuffer:    Buffer;
  filename:     string;
  documentTitle: string;
  documentBody?: string;
  severity?:    "critical" | "attention" | "opportunity";
} | null> {
  const merchant = await prisma.merchant.findUnique({
    where:  { id: args.merchantId },
    select: { name: true, businessName: true, currency: true }
  });
  if (!merchant) return null;
  const merchantName = merchant.businessName || merchant.name || "";
  const slugMerchant = slug(merchantName);
  const today = new Date().toISOString().slice(0, 10);

  if (args.payload.reportType === "single_insight") {
    if (!args.payload.insightId) return null;
    const insight = await prisma.insight.findFirst({
      where: { id: args.payload.insightId, merchantId: args.merchantId }
    });
    if (!insight) return null;

    const html = renderInsightCardTemplate({
      data: {
        type:         insight.type as any,
        title:        insight.title,
        body:         insight.body,
        category:     insight.category,
        ctaLabel:     insight.ctaLabel || undefined,
        numericRefs:  (insight.numericRefs as any) || undefined,
        language:     args.payload.locale,
        generatedAt:  insight.generatedAt,
        merchantName,
        currency:     merchant.currency || undefined
      },
      theme:  args.payload.theme,
      locale: args.payload.locale
    });
    const pdfBuffer = await renderPdf({
      html,
      metadata: {
        title:    `${pdfT("insightTitle", args.payload.locale)} — ${insight.title.slice(0, 80)}`,
        author:   merchantName,
        subject:  pdfT("generatedBy", args.payload.locale),
        creator:  "Zyrix",
        producer: "Zyrix FinSuite"
      }
    });
    return {
      pdfBuffer,
      filename: `zyrix-insight-${slugMerchant}-${insight.generatedAt.toISOString().slice(0, 10)}.pdf`,
      documentTitle: insight.title,
      documentBody:  insight.body.length > 280 ? insight.body.slice(0, 277) + "…" : insight.body,
      severity: (insight.type.toLowerCase() as any)
    };
  }

  if (args.payload.reportType === "daily_brief") {
    const dateStr = args.payload.reportParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(args.payload.reportParams.date)
      ? args.payload.reportParams.date : today;
    const briefDate = new Date(dateStr + "T00:00:00Z");
    const brief = await prisma.customerDailyBrief.findFirst({
      where: { customerUserId: args.merchantId, briefDate }
    });
    if (!brief) return null;

    const cards: DailyBriefCard[] = [];
    const c = brief.criticalCard as any, a = brief.attentionCard as any, o = brief.opportunityCard as any;
    if (c?.title) cards.push({ type: "CRITICAL",    title: c.title, body: c.description || "", ctaLabel: c.actionLabel });
    if (a?.title) cards.push({ type: "ATTENTION",   title: a.title, body: a.description || "", ctaLabel: a.actionLabel });
    if (o?.title) cards.push({ type: "OPPORTUNITY", title: o.title, body: o.description || "", ctaLabel: o.actionLabel });

    const recent = await prisma.insight.findFirst({
      where:   { merchantId: args.merchantId, generatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { generatedAt: "desc" }
    });
    const kpis = (recent?.numericRefs as any) || {};

    const html = renderDailyBriefTemplate({
      data: { date: briefDate, merchantName, cards, kpis, currency: merchant.currency || undefined },
      theme:  args.payload.theme,
      locale: args.payload.locale
    });
    const pdfBuffer = await renderPdf({
      html,
      metadata: {
        title:    `${pdfT("dailyBriefTitle", args.payload.locale)} — ${merchantName} — ${dateStr}`,
        author:   merchantName,
        subject:  pdfT("generatedBy", args.payload.locale),
        creator:  "Zyrix",
        producer: "Zyrix FinSuite"
      }
    });
    return {
      pdfBuffer,
      filename: `zyrix-daily-brief-${slugMerchant}-${dateStr}.pdf`,
      documentTitle: `${pdfT("dailyBriefTitle", args.payload.locale)} · ${merchantName}`,
      documentBody:  cards[0]?.body
    };
  }

  // range_report
  const rp = args.payload.reportParams || {};
  if (!rp.startDate || !rp.endDate
      || !/^\d{4}-\d{2}-\d{2}$/.test(rp.startDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(rp.endDate)) {
    return null;
  }
  const startDate = new Date(rp.startDate + "T00:00:00Z");
  const endDate   = new Date(rp.endDate   + "T23:59:59Z");
  const days = (endDate.getTime() - startDate.getTime()) / 86400000;
  if (days > 90 || days < 0) return null;

  const sectionsAllowed: SectionKey[] = ["insights", "kpis", "customers", "taxes", "cashflow"];
  const sections: SectionKey[] = (rp.sections || ["insights", "kpis"])
    .map((s: any) => String(s).toLowerCase())
    .filter((s: string) => sectionsAllowed.includes(s as SectionKey)) as SectionKey[];

  const insightsRaw = await prisma.insight.findMany({
    where:   { merchantId: args.merchantId, generatedAt: { gte: startDate, lte: endDate }, status: { not: "ARCHIVED" as any } },
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
  const html = renderRangeReportTemplate({ data, theme: args.payload.theme, locale: args.payload.locale });
  const pdfBuffer = await renderPdf({
    html,
    metadata: {
      title:    `${pdfT("rangeTitle", args.payload.locale)} — ${merchantName} — ${rp.startDate}_${rp.endDate}`,
      author:   merchantName,
      subject:  pdfT("generatedBy", args.payload.locale),
      creator:  "Zyrix",
      producer: "Zyrix FinSuite"
    }
  });
  return {
    pdfBuffer,
    filename: `zyrix-range-report-${slugMerchant}-${rp.startDate}_${rp.endDate}.pdf`,
    documentTitle: `${pdfT("rangeTitle", args.payload.locale)} · ${merchantName}`,
    documentBody:  insights[0]?.body
  };
}

// ─── Resolve recipient ─────────────────────────────────────────
async function resolveRecipient(args: {
  merchantId:   string;
  recipientId?: string | null;
  recipient?:   { name: string; email?: string; phone?: string; role?: string };
}): Promise<{
  recipientId:   string | null;
  name:          string;
  email:         string | null;
  phone:         string | null;
  role:          string | null;
  snapshot:      any;
} | { error: string }> {
  if (args.recipientId) {
    const r = await prisma.sharingRecipient.findFirst({
      where: { id: args.recipientId, merchantId: args.merchantId }
    });
    if (!r) return { error: "Recipient not found." };
    return {
      recipientId: r.id,
      name:        r.name,
      email:       r.email,
      phone:       r.phone,
      role:        r.role,
      snapshot:    { name: r.name, email: r.email, phone: r.phone, role: r.role }
    };
  }
  // ad-hoc
  const ad = args.recipient;
  if (!ad?.name) return { error: "Recipient name is required." };
  const email = ad.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ad.email) ? ad.email : null;
  const phone = ad.phone ? e164(ad.phone) : null;
  if (!email && !phone) return { error: "Recipient must have email or phone." };
  return {
    recipientId: null,
    name:        ad.name.slice(0, 120),
    email,
    phone,
    role:        ad.role || null,
    snapshot:    { name: ad.name, email, phone, role: ad.role || null }
  };
}

// ─── Bump recipient lastUsed/shareCount ────────────────────────
async function touchRecipient(recipientId: string): Promise<void> {
  await prisma.sharingRecipient.update({
    where: { id: recipientId },
    data:  { lastUsedAt: new Date(), shareCount: { increment: 1 } }
  }).catch(() => undefined);
}

// Share event sink — see src/services/sharing/shareEvents.ts.
// D-4 notification engine subscribes there without controller changes.

// ─── Endpoints ─────────────────────────────────────────────────
export const sharingController = {

  // POST /api/customer/share/email
  email: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const limit = checkRateLimit(userId);
      if (limit.ok === false) {
        res.status(429).json({ success: false, error: "Rate limit reached.", retryInSec: limit.retryInSec });
        return;
      }

      const payload: SharePayload = {
        reportType:   req.body?.reportType,
        insightId:    req.body?.insightId,
        reportParams: req.body?.reportParams,
        recipientId:  req.body?.recipientId,
        recipient:    req.body?.recipient,
        customMessage: req.body?.customMessage,
        locale:       pickLocale(req),
        theme:        pickTheme(req)
      };
      if (!["single_insight", "daily_brief", "range_report"].includes(payload.reportType)) {
        res.status(400).json({ success: false, error: "Invalid reportType." }); return;
      }

      const recipient = await resolveRecipient({
        merchantId:  userId,
        recipientId: payload.recipientId,
        recipient:   payload.recipient
      });
      if ("error" in recipient) {
        res.status(400).json({ success: false, error: recipient.error }); return;
      }
      if (!recipient.email) {
        res.status(400).json({ success: false, error: "Recipient must have email for email channel." });
        return;
      }

      // Render PDF (will throw or return null on bad data)
      let rendered: Awaited<ReturnType<typeof renderForShare>>;
      try {
        rendered = await renderForShare({ payload, merchantId: userId });
      } catch (renderErr: any) {
        // Persist the failed share for audit, then surface the error.
        const failed = await prisma.insightShare.create({
          data: {
            merchantId: userId,
            insightId:  payload.insightId || null,
            reportType: payload.reportType,
            channel:    "email",
            recipientId: recipient.recipientId,
            recipientSnapshot: recipient.snapshot,
            message:    payload.customMessage || "",
            status:     "failed",
            errorMessage: `pdf_render_failed: ${renderErr?.message || renderErr}`
          }
        });
        emitShareEvent({ type: "share.failed", shareId: failed.id, merchantId: userId, channel: "email" });
        res.status(503).json({
          success: false,
          error:   "PDF rendering currently unavailable; share recorded as failed.",
          shareId: failed.id
        });
        return;
      }
      if (!rendered) {
        res.status(404).json({ success: false, error: "Source document not found for this report." });
        return;
      }

      const merchantUser = await prisma.merchant.findUnique({
        where: { id: userId }, select: { name: true, businessName: true }
      });
      const senderName = merchantUser?.businessName || merchantUser?.name || "Zyrix";

      const sendResult = await sendShareEmail({
        to:            recipient.email,
        senderName,
        customMessage: payload.customMessage,
        document: {
          type:     payload.reportType,
          title:    rendered.documentTitle,
          body:     rendered.documentBody,
          severity: rendered.severity
        },
        pdfBuffer:   rendered.pdfBuffer,
        pdfFilename: rendered.filename,
        locale:      payload.locale
      });

      const share = await prisma.insightShare.create({
        data: {
          merchantId: userId,
          insightId:  payload.insightId || null,
          reportType: payload.reportType,
          channel:    "email",
          recipientId: recipient.recipientId,
          recipientSnapshot: recipient.snapshot,
          message:    payload.customMessage || "",
          status:     sendResult.success ? "sent" : "failed",
          errorMessage: sendResult.success ? null : (sendResult.error || "send_failed")
        }
      });

      if (sendResult.success && recipient.recipientId) {
        await touchRecipient(recipient.recipientId);
      }
      emitShareEvent({
        type: sendResult.success ? "share.sent" : "share.failed",
        shareId: share.id, merchantId: userId, channel: "email"
      });

      if (!sendResult.success) {
        res.status(502).json({ success: false, error: sendResult.error || "Email send failed.", shareId: share.id });
        return;
      }
      res.status(200).json({
        success: true,
        data: { shareId: share.id, status: share.status, providerMessageId: sendResult.providerMessageId }
      });
    } catch (err: any) {
      console.error("[share/email] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to send share email." });
    }
  }),

  // POST /api/customer/share/whatsapp
  whatsapp: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const limit = checkRateLimit(userId);
      if (limit.ok === false) {
        res.status(429).json({ success: false, error: "Rate limit reached.", retryInSec: limit.retryInSec });
        return;
      }

      const payload: SharePayload = {
        reportType:   req.body?.reportType,
        insightId:    req.body?.insightId,
        reportParams: req.body?.reportParams,
        recipientId:  req.body?.recipientId,
        recipient:    req.body?.recipient,
        customMessage: req.body?.customMessage,
        locale:       pickLocale(req),
        theme:        pickTheme(req)
      };
      if (!["single_insight", "daily_brief", "range_report"].includes(payload.reportType)) {
        res.status(400).json({ success: false, error: "Invalid reportType." }); return;
      }

      const recipient = await resolveRecipient({
        merchantId:  userId,
        recipientId: payload.recipientId,
        recipient:   payload.recipient
      });
      if ("error" in recipient) {
        res.status(400).json({ success: false, error: recipient.error }); return;
      }
      // For WhatsApp, phone is preferred but optional — wa.me/?text= works without phone.

      // Lightweight document metadata for the wa.me message preview;
      // we DON'T render the PDF here. The recipient triggers rendering
      // by tapping the /share/:token link.
      const docMeta = await loadDocumentPreview({ merchantId: userId, payload });
      if (!docMeta) {
        res.status(404).json({ success: false, error: "Source document not found." });
        return;
      }

      // Persist the share row first so we have the id for the share token.
      const share = await prisma.insightShare.create({
        data: {
          merchantId: userId,
          insightId:  payload.insightId || null,
          reportType: payload.reportType,
          channel:    "whatsapp",
          recipientId: recipient.recipientId,
          recipientSnapshot: { ...recipient.snapshot, reportParams: payload.reportParams || null, theme: payload.theme, locale: payload.locale },
          message:    payload.customMessage || "",
          status:     "sent"   // for wa.me, "sent" means link was generated
        }
      });

      // Sign a 7-day JWT and stamp it on the share row.
      const pdfShareToken = signShareToken({ shareId: share.id, merchantId: userId });
      await prisma.insightShare.update({
        where: { id: share.id },
        data:  { pdfShareToken }
      });
      const pdfUrl = `${publicBaseUrl()}/share/${pdfShareToken}`;

      const link = buildWaShareLink({
        document: {
          type:     payload.reportType,
          title:    docMeta.title,
          body:     docMeta.body,
          severity: docMeta.severity
        },
        customMessage: payload.customMessage,
        pdfUrl,
        locale: payload.locale,
        phone:  recipient.phone || undefined
      });

      if (recipient.recipientId) await touchRecipient(recipient.recipientId);
      emitShareEvent({ type: "share.sent", shareId: share.id, merchantId: userId, channel: "whatsapp" });

      res.status(200).json({
        success: true,
        data: {
          shareId:   share.id,
          shareUrl:  link.shareUrl,
          message:   link.message,
          hasPhone:  link.hasPhone,
          pdfUrl
        }
      });
    } catch (err: any) {
      console.error("[share/whatsapp] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to build WhatsApp share link." });
    }
  }),

  // GET /api/customer/shares/history?days=30&limit=100
  history: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const daysRaw  = parseInt(String(req.query.days  ?? "30"), 10);
      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);
      const days  = Math.min(Math.max(Number.isFinite(daysRaw)  ? daysRaw  : 30,  1), 365);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await prisma.insightShare.findMany({
        where:   { merchantId: userId, sentAt: { gte: since } },
        orderBy: { sentAt: "desc" },
        take:    limit,
        select: {
          id: true, insightId: true, reportType: true, channel: true,
          recipientId: true, recipientSnapshot: true, message: true,
          status: true, sentAt: true, deliveredAt: true, openedAt: true,
          errorMessage: true, downloadCount: true, firstDownloadedAt: true,
          insight: { select: { id: true, title: true, type: true } }
        }
      });

      res.status(200).json({
        success: true,
        data: { shares: rows, count: rows.length, days, limit }
      });
    } catch (err: any) {
      console.error("[shares/history] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load share history." });
    }
  })
};

// ─── Lightweight preview loader (no PDF render) ────────────────
async function loadDocumentPreview(args: {
  merchantId: string;
  payload:    SharePayload;
}): Promise<{
  title:    string;
  body?:    string;
  severity?: "critical" | "attention" | "opportunity";
} | null> {
  const merchant = await prisma.merchant.findUnique({
    where:  { id: args.merchantId },
    select: { name: true, businessName: true }
  });
  if (!merchant) return null;
  const merchantName = merchant.businessName || merchant.name || "";

  if (args.payload.reportType === "single_insight") {
    if (!args.payload.insightId) return null;
    const insight = await prisma.insight.findFirst({
      where: { id: args.payload.insightId, merchantId: args.merchantId },
      select: { title: true, body: true, type: true }
    });
    if (!insight) return null;
    return {
      title:    insight.title,
      body:     insight.body.length > 200 ? insight.body.slice(0, 197) + "…" : insight.body,
      severity: (insight.type.toLowerCase() as any)
    };
  }
  if (args.payload.reportType === "daily_brief") {
    const dateStr = args.payload.reportParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(args.payload.reportParams.date)
      ? args.payload.reportParams.date : new Date().toISOString().slice(0, 10);
    return { title: `${merchantName} · ${dateStr}` };
  }
  // range_report
  const rp = args.payload.reportParams || {};
  if (!rp.startDate || !rp.endDate) return null;
  return { title: `${merchantName} · ${rp.startDate} → ${rp.endDate}` };
}
