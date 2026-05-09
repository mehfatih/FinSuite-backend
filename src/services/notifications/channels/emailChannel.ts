// ================================================================
// channels/emailChannel.ts — Resend-backed email driver.
// Sends a branded notification email. Three template variants
// (critical / attention / opportunity) sharing the same shell.
// ================================================================
import { Resend } from "resend";
import { env } from "../../../config/env";
import { prisma } from "../../../config/database";
import { buildNotificationEmail } from "../templates/notificationEmail";
import type { ChannelDriver, ChannelResult } from "../types";

const resend = new Resend(env.resendApiKey);
const FROM   = "Zyrix FinSuite <hello@zyrix.co>";

export const emailChannel: ChannelDriver = {
  channel: "email",
  async send({ event }): Promise<ChannelResult> {
    try {
      const merchant = await prisma.merchant.findUnique({
        where:  { id: event.merchantId },
        select: { email: true, name: true, businessName: true, language: true }
      });
      if (!merchant?.email) {
        return { channel: "email", success: false, error: "merchant_no_email" };
      }
      const locale = (merchant.language || "TR").toLowerCase() as "tr" | "ar" | "en";
      const html   = buildNotificationEmail({
        severity:    event.severity,
        title:       event.title,
        body:        event.body,
        ctaLabel:    event.ctaLabel,
        ctaRoute:    event.ctaRoute,
        merchantName: merchant.businessName || merchant.name || "",
        locale
      });
      const subject = subjectFor(event.severity, event.title, locale);

      const result: any = await resend.emails.send({
        from:    FROM,
        to:      merchant.email,
        subject,
        html
      });
      if (result?.error) {
        return { channel: "email", success: false, error: String(result.error?.message || result.error) };
      }
      const id = result?.data?.id || result?.id;
      return { channel: "email", success: true, refId: id };
    } catch (err: any) {
      return { channel: "email", success: false, error: err?.message || String(err) };
    }
  }
};

function subjectFor(
  severity: string,
  title: string,
  locale: "tr" | "ar" | "en"
): string {
  const sevTag = severity === "CRITICAL"    ? { tr: "🔴 KRİTİK", en: "🔴 CRITICAL", ar: "🔴 حرج" }
              : severity === "ATTENTION"   ? { tr: "🟡 DİKKAT", en: "🟡 ATTENTION", ar: "🟡 تنبيه" }
              : severity === "OPPORTUNITY" ? { tr: "🟢 FIRSAT", en: "🟢 OPPORTUNITY", ar: "🟢 فرصة" }
                                              : { tr: "🔔 Bildirim", en: "🔔 Notification", ar: "🔔 إشعار" };
  return `${sevTag[locale] || sevTag.tr} · ${title.slice(0, 90)}`;
}
