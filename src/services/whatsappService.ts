// ============================================================
// Zyrix FinSuite - WhatsApp Service (Meta Cloud API)
// Sprint 1 Phase 1B
//
// Sends invoice messages via WhatsApp Business Cloud API.
// Reuses the same Meta integration pattern Levana Cosmetics uses.
// ============================================================

import { env } from "../config/env";

export type WhatsAppSendInput = {
  recipientPhone: string;     // E.164 format, e.g. "+905551234567"
  bodyText?: string;
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
};

export type WhatsAppSendResult = {
  success: boolean;
  providerMessageId?: string;
  providerResponse?: any;
  error?: string;
};

const META_API_BASE = "https://graph.facebook.com/v20.0";

function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+")) return cleaned.substring(1);
  return cleaned;
}

export async function sendWhatsAppMessage(
  input: WhatsAppSendInput
): Promise<WhatsAppSendResult> {
  if (!env.whatsappToken || !env.whatsappPhoneId) {
    return {
      success: false,
      error:
        "WhatsApp credentials not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID.",
    };
  }

  const phone = normalizePhone(input.recipientPhone);
  if (!phone || phone.length < 10) {
    return { success: false, error: "Invalid recipient phone" };
  }

  // Build the request body. If templateName is given, use template path.
  // Otherwise send a plain text message.
  let body: any;
  if (input.templateName) {
    body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: "tr" },
        components: input.templateParams && input.templateParams.length > 0
          ? [
              {
                type: "body",
                parameters: input.templateParams.map((p) => ({
                  type: "text",
                  text: p,
                })),
              },
            ]
          : [],
      },
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: input.bodyText || "" },
    };
  }

  const url = META_API_BASE + "/" + env.whatsappPhoneId + "/messages";

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.whatsappToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return {
        success: false,
        error:
          (json && json.error && json.error.message) ||
          "Meta API returned " + resp.status,
        providerResponse: json,
      };
    }

    const messageId =
      json &&
      json.messages &&
      Array.isArray(json.messages) &&
      json.messages[0] &&
      json.messages[0].id;

    return {
      success: true,
      providerMessageId: messageId || undefined,
      providerResponse: json,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: "Network error: " + msg };
  }
}
