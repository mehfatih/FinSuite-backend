// ================================================================
// sendShareEmail.ts — Resend-backed share-by-email sender.
// Implements option (δ) from the discovery doc: PDF attached as a
// base64 inline attachment via Resend's `attachments` field.
//
// Limits Resend enforces: total payload ≤ 40 MB. Our PDFs are
// expected to be 0.3–2 MB (per Sprint D-2 §B.7 quality gates), so
// even a multi-page range report fits comfortably.
//
// Returns a `SendShareEmailResult` so the caller can stamp
// status / errorMessage on the InsightShare row.
// ================================================================
import { Resend } from "resend";
import { env } from "../../config/env";
import { buildShareEmailHtml, buildShareEmailSubject, ShareEmailArgs } from "./shareEmailTemplate";

const resend = new Resend(env.resendApiKey);

const SHARE_FROM = "Zyrix FinSuite <hello@zyrix.co>";

export interface SendShareEmailArgs extends ShareEmailArgs {
  to:           string;
  pdfBuffer?:   Buffer;
  pdfFilename?: string;
}

export interface SendShareEmailResult {
  success:           boolean;
  providerMessageId?: string;
  error?:            string;
}

export async function sendShareEmail(args: SendShareEmailArgs): Promise<SendShareEmailResult> {
  const subject = buildShareEmailSubject(args);
  const html    = buildShareEmailHtml({
    ...args,
    pdfFilename:  args.pdfFilename || (args.pdfBuffer ? "zyrix-document.pdf" : undefined),
    pdfSizeBytes: args.pdfBuffer?.length
  });

  const attachments = args.pdfBuffer
    ? [{
        filename: args.pdfFilename || "zyrix-document.pdf",
        content:  args.pdfBuffer.toString("base64")
      }]
    : undefined;

  try {
    const result: any = await resend.emails.send({
      from:        SHARE_FROM,
      to:          args.to,
      subject,
      html,
      attachments
    });

    if (result?.error) {
      return { success: false, error: String(result.error?.message || result.error) };
    }
    return { success: true, providerMessageId: result?.data?.id || result?.id };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
