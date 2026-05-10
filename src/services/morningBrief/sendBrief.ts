// ================================================================
// Sprint D-5 — sendMorningBrief() — wires generator + template +
// Resend + MorningBriefSend audit row.
//
// Called by services/morningBrief/scheduler.ts during a tick.
// Errors here are NEVER thrown — the scheduler catches but we
// also return ok=false with a reason so failed/stub/sent counters
// stay correct.
// ================================================================
import { Resend } from "resend";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { generateBrief } from "./generator";
import { renderMorningBriefHtml, renderMorningBriefText } from "./emailTemplate";
import { buildUnsubUrl } from "./unsubscribeToken";
import type { ScheduleSubscription, ScheduleMerchant } from "./scheduler";

const resend = new Resend(env.resendApiKey);
const FROM   = "Zyrix FinSuite <hello@zyrix.co>";

export interface SendBriefResult {
  ok:      boolean;
  sendId?: string;
  reason?: string;
}

export async function sendMorningBrief(args: {
  sub:      ScheduleSubscription;
  merchant: ScheduleMerchant;
}): Promise<SendBriefResult> {
  const { sub, merchant } = args;

  if (!merchant.email) {
    return { ok: false, reason: "merchant_no_email" };
  }
  if (!env.resendApiKey) {
    return { ok: false, reason: "resend_not_configured" };
  }

  // 1. Build the brief payload (cache hit ~95%; loopback otherwise).
  let brief;
  try {
    brief = await generateBrief({ merchant });
  } catch (err: any) {
    return { ok: false, reason: `generate_failed: ${err?.message || err}` };
  }

  // 2. Render HTML + plain text, with a real signed unsubscribe URL.
  const unsubUrl = buildUnsubUrl(merchant.id);
  const html = renderMorningBriefHtml({ brief, unsubUrl });
  const text = renderMorningBriefText(brief);

  // 3. Insert the audit row first so we can stamp providerMessageId
  //    even if the post-Resend update somehow loses the response.
  let sendRow;
  try {
    sendRow = await prisma.morningBriefSend.create({
      data: {
        merchantId: merchant.id,
        variant:    sub.variant,
        subject:    brief.subject,
        insightIds: brief.insightIds,
        status:     "sent"
      }
    });
  } catch (err: any) {
    return { ok: false, reason: `send_row_create_failed: ${err?.message || err}` };
  }

  // 4. Dispatch via Resend. Tag with morning-brief so the webhook
  //    handler (and any future analytics) can route by tag.
  try {
    const result: any = await resend.emails.send({
      from:    FROM,
      to:      merchant.email,
      subject: brief.subject,
      html,
      text,
      headers: {
        // List-Unsubscribe RFC 8058: enables Gmail one-click unsubscribe.
        "List-Unsubscribe":      `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      },
      tags: [
        { name: "type",    value: "morning-brief" },
        { name: "variant", value: sub.variant }
      ]
    });
    if (result?.error) {
      const msg = String(result.error?.message || result.error);
      await prisma.morningBriefSend.update({
        where: { id: sendRow.id },
        data:  { status: "failed", bounceReason: msg }
      }).catch(() => undefined);
      return { ok: false, sendId: sendRow.id, reason: `resend_error: ${msg}` };
    }
    const providerId = result?.data?.id || result?.id || null;
    if (providerId) {
      await prisma.morningBriefSend.update({
        where: { id: sendRow.id },
        data:  { providerMessageId: providerId }
      }).catch((err) =>
        console.error(`[morning-brief/sendBrief] providerMessageId update failed for send ${sendRow.id}:`, err?.message || err)
      );
    }
    return { ok: true, sendId: sendRow.id };
  } catch (err: any) {
    await prisma.morningBriefSend.update({
      where: { id: sendRow.id },
      data:  { status: "failed", bounceReason: err?.message || String(err) }
    }).catch(() => undefined);
    return { ok: false, sendId: sendRow.id, reason: `resend_threw: ${err?.message || err}` };
  }
}
