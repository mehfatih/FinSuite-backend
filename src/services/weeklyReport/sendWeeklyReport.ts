// ================================================================
// Sprint D-6 — Weekly report send pipeline.
//
// Orchestrates: generator (cache-or-create row) → renderReportPdf
// (on-demand PDF buffer per decision §6.B) → resend.emails.send
// with PDF attachment + List-Unsubscribe headers → WeeklyReportSend
// audit row → SHARE_EVENT notification dispatch.
//
// Failure semantics: every step is try/caught. The Send row is
// inserted upfront so engagement tracking still flags failed
// dispatches; the row's status moves to 'failed' if Resend errors.
// ================================================================
import { Resend } from "resend";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { generateWeeklyReport } from "./generator";
import { renderReportPdf } from "./renderReportPdf";
import { buildSubject, renderWeeklyReportEmailHtml, renderWeeklyReportEmailText, Locale } from "./emailTemplate";
import { buildUnsubUrl } from "./unsubscribeToken";
import type { WeeklySnapshot } from "./weeklyKpis";

const resend = new Resend(env.resendApiKey);
const FROM   = "Zyrix FinSuite <hello@zyrix.co>";

const APP_BASE = (process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co").replace(/\/$/, "");

export interface SendArgs {
  merchantId: string;
  weekStart:  Date;
  weekEnd:    Date;
  language?:  Locale;
  force?:     boolean;       // pass through to generator (re-prompt narrative)
}

export interface SendResult {
  ok:        boolean;
  reportId?: string;
  sendId?:   string;
  reused?:   boolean;        // generator reused existing row
  reason?:   string;
}

export async function sendWeeklyReport(args: SendArgs): Promise<SendResult> {
  const language: Locale = args.language || "tr";

  if (!env.resendApiKey) {
    return { ok: false, reason: "resend_not_configured" };
  }

  // 1. Ensure the row exists (idempotent — reuses by [merchantId, weekStart]).
  let generated;
  try {
    generated = await generateWeeklyReport({
      merchantId: args.merchantId,
      weekStart:  args.weekStart,
      weekEnd:    args.weekEnd,
      language,
      force:      args.force
    });
  } catch (err: any) {
    return { ok: false, reason: `generate_failed: ${err?.message || err}` };
  }

  // 2. Fetch merchant for to-address + display name.
  const merchant = await prisma.merchant.findUnique({
    where:  { id: args.merchantId },
    select: { email: true, name: true, businessName: true }
  });
  if (!merchant?.email) {
    return { ok: false, reportId: generated.reportId, reason: "merchant_no_email" };
  }
  const merchantName = merchant.businessName || merchant.name || "—";

  // 3. Render the PDF buffer on demand.
  let pdf;
  try {
    pdf = await renderReportPdf({ reportId: generated.reportId });
  } catch (err: any) {
    return { ok: false, reportId: generated.reportId, reason: `pdf_render_failed: ${err?.message || err}` };
  }

  // 4. Insert Send audit row (so any subsequent failure still
  //    surfaces in admin engagement metrics).
  const subject = buildSubject({ snapshot: generated.snapshot as unknown as WeeklySnapshot, language });
  let sendRow;
  try {
    sendRow = await prisma.weeklyReportSend.create({
      data: {
        merchantId: args.merchantId,
        reportId:   generated.reportId,
        subject,
        status:     "sent"
      }
    });
  } catch (err: any) {
    return { ok: false, reportId: generated.reportId, reason: `send_row_create_failed: ${err?.message || err}` };
  }

  // 5. Render email + dispatch via Resend with attachment.
  const unsubUrl = buildUnsubUrl(args.merchantId);
  const html = renderWeeklyReportEmailHtml({
    snapshot:     generated.snapshot as unknown as WeeklySnapshot,
    merchantName,
    reportId:     generated.reportId,
    unsubUrl,
    language,
    appBaseUrl:   APP_BASE
  });
  const text = renderWeeklyReportEmailText({
    snapshot:     generated.snapshot as unknown as WeeklySnapshot,
    merchantName,
    language,
    reportUrl:    `${APP_BASE}/reports/weekly/${encodeURIComponent(generated.reportId)}`
  });

  try {
    const result: any = await resend.emails.send({
      from:    FROM,
      to:      merchant.email,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe":      `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      attachments: [{
        filename: pdf.filename,
        content:  pdf.buffer.toString("base64")
      }],
      tags: [
        { name: "type", value: "weekly-report" }
      ]
    });
    if (result?.error) {
      const msg = String(result.error?.message || result.error);
      await prisma.weeklyReportSend.update({
        where: { id: sendRow.id },
        data:  { status: "failed", bounceReason: msg }
      }).catch(() => undefined);
      return { ok: false, reportId: generated.reportId, sendId: sendRow.id, reason: `resend_error: ${msg}` };
    }
    const providerId = result?.data?.id || result?.id || null;
    if (providerId) {
      await prisma.weeklyReportSend.update({
        where: { id: sendRow.id },
        data:  { providerMessageId: providerId }
      }).catch((err) =>
        console.error(`[weeklyReport/sendWeeklyReport] providerMessageId update failed for send ${sendRow.id}:`, err?.message || err)
      );
    }

    // 6. Fire SHARE_EVENT notification (decision §6.F option F1).
    await fireReportReadyNotification({
      merchantId: args.merchantId,
      reportId:   generated.reportId,
      language
    });

    return { ok: true, reportId: generated.reportId, sendId: sendRow.id, reused: generated.reused };
  } catch (err: any) {
    await prisma.weeklyReportSend.update({
      where: { id: sendRow.id },
      data:  { status: "failed", bounceReason: err?.message || String(err) }
    }).catch(() => undefined);
    return { ok: false, reportId: generated.reportId, sendId: sendRow.id, reason: `resend_threw: ${err?.message || err}` };
  }
}

const READY_TITLE = {
  tr: "Haftalık raporun hazır",
  en: "Your weekly report is ready",
  ar: "تقرير أسبوعك جاهز"
} as const;

const READY_BODY = {
  tr: "Bu haftaki performansını incelemek için raporu aç.",
  en: "Open the report to review this week's performance.",
  ar: "افتح التقرير لمراجعة أداء هذا الأسبوع."
} as const;

const CTA_LABEL = {
  tr: "Raporu aç",
  en: "Open report",
  ar: "افتح التقرير"
} as const;

async function fireReportReadyNotification(args: {
  merchantId: string;
  reportId:   string;
  language:   Locale;
}): Promise<void> {
  // Lazy import to keep the notification engine off the hot path of
  // brief-only sends (mirrors aiBriefController's pattern).
  try {
    const { dispatch } = await import("../notifications/engine");
    await dispatch({
      merchantId: args.merchantId,
      severity:   "SHARE_EVENT",
      type:       "weekly_report_ready",
      title:      READY_TITLE[args.language] || READY_TITLE.tr,
      body:       READY_BODY[args.language]  || READY_BODY.tr,
      iconTone:   "violet",
      ctaLabel:   CTA_LABEL[args.language]   || CTA_LABEL.tr,
      ctaRoute:   `/reports/weekly/${args.reportId}`,
      data:       { reportId: args.reportId }
    });
  } catch (err: any) {
    console.error(`[weeklyReport/sendWeeklyReport] notification dispatch failed for ${args.merchantId}:`, err?.message || err);
  }
}
