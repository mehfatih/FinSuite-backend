// ============================================================
// Zyrix FinSuite - WhatsApp Controller
// Sprint 1 Phase 1B
//
// Endpoints (all authenticated):
//   POST /api/whatsapp/send-invoice/:invoiceId  send an invoice via WA
//   GET  /api/whatsapp                          list sent messages
//   GET  /api/whatsapp/:id                      get one message
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { sendWhatsAppMessage } from "../services/whatsappService";
import { sendDueReminders, runRemindersForAll } from "../services/whatsappReminderService";

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
    language?: string;
  };
}

const sendInvoiceSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(20).optional(),
  customMessage: z.string().max(1000).optional(),
});

const sendPdfSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(20).optional(),
  pdfUrl: z.string().url(),
  caption: z.string().max(500).optional(),
  documentName: z.string().max(100).optional(),
});

const sendMediaSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(20),
  mediaUrl: z.string().url(),
  mediaType: z.enum(["image", "document", "video"]).default("document"),
  caption: z.string().max(500).optional(),
  documentName: z.string().max(100).optional(),
});

const bulkSendSchema = z.object({
  recipients: z.array(z.string().trim().min(8).max(20)).min(1).max(100),
  bodyText: z.string().min(1).max(4000),
  campaignName: z.string().max(100).optional(),
});

const listSchema = z.object({
  status: z
    .enum(["PENDING", "QUEUED", "SENT", "DELIVERED", "READ", "FAILED"])
    .optional(),
  invoiceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /api/whatsapp/send-invoice/:invoiceId
// ----------------------------------------------------------------

export async function sendInvoiceHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const invoiceId = String(req.params.invoiceId || "");
  if (!invoiceId) return fail(res, 400, "invoiceId is required");

  const parsed = sendInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { recipientPhone, customMessage } = parsed.data;

  // Load invoice
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, merchantId: req.merchant.id },
  });
  if (!invoice) return fail(res, 404, "Invoice not found");

  const phone = recipientPhone || invoice.customerPhone;
  if (!phone) {
    return fail(
      res,
      422,
      "No recipient phone. Provide one or set customer phone on the invoice."
    );
  }

  // Build message text
  const total = String(invoice.total);
  const text =
    customMessage ||
    "Merhaba " +
      invoice.customerName +
      ", #" +
      invoice.invoiceNumber +
      " numarali faturaniz hazirdir. Tutar: " +
      total +
      " " +
      invoice.currency +
      ". Vade: " +
      invoice.dueDate.toISOString().substring(0, 10);

  // 1. Insert PENDING row
  const initial = await prisma.whatsAppMessage.create({
    data: {
      merchantId: req.merchant.id,
      invoiceId: invoice.id,
      recipientPhone: phone,
      messageType: "invoice",
      bodyText: text,
      status: "PENDING" as any,
    } as any,
  });

  // 2. Send via Meta Cloud API
  const result = await sendWhatsAppMessage({
    recipientPhone: phone,
    bodyText: text,
  });

  // 3. Persist outcome
  if (!result.success) {
    const failed = await prisma.whatsAppMessage.update({
      where: { id: initial.id },
      data: {
        status: "FAILED" as any,
        failureReason: result.error || "Unknown error",
        providerResponse: (result.providerResponse as any) || undefined,
      } as any,
    });
    return fail(res, 502, result.error || "WhatsApp send failed");
  }

  const sent = await prisma.whatsAppMessage.update({
    where: { id: initial.id },
    data: {
      status: "SENT" as any,
      providerMessageId: result.providerMessageId || null,
      providerResponse: (result.providerResponse as any) || undefined,
      sentAt: new Date(),
    } as any,
  });

  // Update Invoice.whatsappSentAt for quick reference
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { whatsappSentAt: new Date() } as any,
  });

  return ok(res, sent, 201);
}

// ----------------------------------------------------------------
// GET /api/whatsapp - list
// ----------------------------------------------------------------

export async function listHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }
  const { status, invoiceId, limit, offset } = parsed.data;

  const where: any = { merchantId: req.merchant.id };
  if (status) where.status = status;
  if (invoiceId) where.invoiceId = invoiceId;

  const [rows, total] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ?? 50,
      skip: offset ?? 0,
    }),
    prisma.whatsAppMessage.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /api/whatsapp/:id
// ----------------------------------------------------------------

export async function getHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");
  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const row = await prisma.whatsAppMessage.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!row) return fail(res, 404, "Not found");

  return ok(res, row);
}

// ----------------------------------------------------------------
// GET /api/whatsapp/webhook - Meta verification (challenge response)
// Public endpoint - Meta calls this once when configuring the webhook.
// ----------------------------------------------------------------

export async function webhookVerifyHandler(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === expectedToken && challenge) {
    return res.status(200).send(String(challenge));
  }
  return res.status(403).send("Forbidden");
}

// ----------------------------------------------------------------
// POST /api/whatsapp/webhook - Meta status updates + inbound messages
// Public endpoint - Meta calls this for every status change.
// Receives: message status (sent/delivered/read/failed) and inbound msgs.
// ----------------------------------------------------------------

export async function webhookReceiveHandler(req: Request, res: Response) {
  // Always 200 quickly so Meta doesn't retry
  res.status(200).send("OK");

  try {
    const body = req.body;

    if (!body || body.object !== "whatsapp_business_account") return;

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change.value || {};

        // 1. Status updates (delivered, read, failed)
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const s of statuses) {
          await handleStatusUpdate(s);
        }

        // 2. Inbound messages (customer replies)
        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const msg of messages) {
          await handleInboundMessage(msg, value);
        }
      }
    }
  } catch (err) {
    // Log but never fail - Meta doesn't care about errors here
    console.error("[whatsapp webhook] error:", err);
  }
}

async function handleStatusUpdate(status: any) {
  const messageId = status?.id;
  const statusName = String(status?.status || "").toUpperCase();
  const timestamp = status?.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date();

  if (!messageId) return;

  const validStatuses = ["SENT", "DELIVERED", "READ", "FAILED"];
  if (!validStatuses.includes(statusName)) return;

  // Find the message we sent (matched by providerMessageId)
  const existing = await prisma.whatsAppMessage.findFirst({
    where: { providerMessageId: messageId },
  });
  if (!existing) return;

  const updates: any = { status: statusName as any };
  if (statusName === "DELIVERED" && !existing.deliveredAt) updates.deliveredAt = timestamp;
  if (statusName === "READ" && !existing.readAt) updates.readAt = timestamp;
  if (statusName === "FAILED") {
    updates.failureReason = status?.errors?.[0]?.title || "Failed";
  }

  await prisma.whatsAppMessage.update({
    where: { id: existing.id },
    data: updates,
  });

  // Sync to invoice.whatsappStatus for quick lookup
  if (existing.invoiceId) {
    await prisma.invoice.update({
      where: { id: existing.invoiceId },
      data: { whatsappStatus: statusName } as any,
    }).catch(() => null);
  }
}

async function handleInboundMessage(msg: any, value: any) {
  const fromPhone = msg?.from;
  const messageType = msg?.type;
  const text = msg?.text?.body || "";
  const messageId = msg?.id;

  if (!fromPhone || !messageId) return;

  // Find merchant by recent outbound to this phone
  // Match the last outbound message we sent to this number
  const lastOutbound = await prisma.whatsAppMessage.findFirst({
    where: { recipientPhone: { contains: fromPhone.replace(/^\+/, "") } },
    orderBy: { createdAt: "desc" },
    select: { merchantId: true },
  });

  if (!lastOutbound) return;

  await prisma.whatsAppMessage.create({
    data: {
      merchantId: lastOutbound.merchantId,
      recipientPhone: fromPhone,
      messageType: "inbound_" + messageType,
      bodyText: text,
      providerMessageId: messageId,
      providerResponse: msg as any,
      status: "DELIVERED" as any,
      sentAt: new Date(),
    } as any,
  });
}

// ----------------------------------------------------------------
// POST /api/whatsapp/send-pdf/:invoiceId - send invoice as PDF document
// ----------------------------------------------------------------

export async function sendPdfHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const invoiceId = String(req.params.invoiceId || "");
  if (!invoiceId) return fail(res, 400, "invoiceId is required");

  const parsed = sendPdfSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { recipientPhone, pdfUrl, caption, documentName } = parsed.data;

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, merchantId: req.merchant.id },
  });
  if (!invoice) return fail(res, 404, "Invoice not found");

  const phone = recipientPhone || invoice.customerPhone;
  if (!phone) return fail(res, 422, "No recipient phone");

  const filename = documentName || ("Fatura-" + invoice.invoiceNumber + ".pdf");
  const captionText = caption || ("Faturaniz: #" + invoice.invoiceNumber);

  const initial = await prisma.whatsAppMessage.create({
    data: {
      merchantId: req.merchant.id,
      invoiceId: invoice.id,
      recipientPhone: phone,
      messageType: "invoice_pdf",
      mediaUrl: pdfUrl,
      bodyText: captionText,
      status: "PENDING" as any,
    } as any,
  });

  const result = await sendWhatsAppMessage({
    recipientPhone: phone,
    mediaUrl: pdfUrl,
    mediaType: "document",
    documentName: filename,
    caption: captionText,
  });

  if (!result.success) {
    await prisma.whatsAppMessage.update({
      where: { id: initial.id },
      data: {
        status: "FAILED" as any,
        failureReason: result.error || "Unknown error",
        providerResponse: (result.providerResponse as any) || undefined,
      } as any,
    });
    return fail(res, 502, result.error || "PDF send failed");
  }

  const sent = await prisma.whatsAppMessage.update({
    where: { id: initial.id },
    data: {
      status: "SENT" as any,
      providerMessageId: result.providerMessageId || null,
      providerResponse: (result.providerResponse as any) || undefined,
      sentAt: new Date(),
    } as any,
  });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { whatsappSentAt: new Date() } as any,
  }).catch(() => null);

  return ok(res, sent, 201);
}

// ----------------------------------------------------------------
// POST /api/whatsapp/send-media - send any media (image/doc/video)
// ----------------------------------------------------------------

export async function sendMediaHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = sendMediaSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { recipientPhone, mediaUrl, mediaType, caption, documentName } = parsed.data;

  const initial = await prisma.whatsAppMessage.create({
    data: {
      merchantId: req.merchant.id,
      recipientPhone: recipientPhone,
      messageType: mediaType,
      mediaUrl: mediaUrl,
      bodyText: caption || null,
      status: "PENDING" as any,
    } as any,
  });

  const result = await sendWhatsAppMessage({
    recipientPhone,
    mediaUrl,
    mediaType,
    documentName,
    caption,
  });

  if (!result.success) {
    await prisma.whatsAppMessage.update({
      where: { id: initial.id },
      data: {
        status: "FAILED" as any,
        failureReason: result.error || "Unknown error",
        providerResponse: (result.providerResponse as any) || undefined,
      } as any,
    });
    return fail(res, 502, result.error || "Media send failed");
  }

  const sent = await prisma.whatsAppMessage.update({
    where: { id: initial.id },
    data: {
      status: "SENT" as any,
      providerMessageId: result.providerMessageId || null,
      providerResponse: (result.providerResponse as any) || undefined,
      sentAt: new Date(),
    } as any,
  });

  return ok(res, sent, 201);
}


// ----------------------------------------------------------------
// POST /api/whatsapp/bulk - send same message to up to 100 recipients
// Returns: per-recipient results (success/failed array)
// Rate-limited separately to prevent abuse.
// ----------------------------------------------------------------

export async function bulkSendHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = bulkSendSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { recipients, bodyText, campaignName } = parsed.data;

  // Deduplicate recipients
  const unique = Array.from(new Set(recipients.map((r) => r.trim())));

  const results: Array<{
    phone: string;
    success: boolean;
    messageId?: string;
    error?: string;
  }> = [];

  // Process sequentially with small delay to respect Meta rate limits
  // (typically 80 msg/sec - we go conservatively at ~10/sec)
  for (const phone of unique) {
    // Insert PENDING row first
    let row;
    try {
      row = await prisma.whatsAppMessage.create({
        data: {
          merchantId: req.merchant.id,
          recipientPhone: phone,
          messageType: "bulk",
          bodyText: bodyText,
          templateName: campaignName || null,
          status: "PENDING" as any,
        } as any,
      });
    } catch (err: any) {
      results.push({ phone, success: false, error: "DB insert failed" });
      continue;
    }

    const result = await sendWhatsAppMessage({
      recipientPhone: phone,
      bodyText,
    });

    if (result.success) {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "SENT" as any,
          providerMessageId: result.providerMessageId || null,
          providerResponse: (result.providerResponse as any) || undefined,
          sentAt: new Date(),
        } as any,
      });
      results.push({
        phone,
        success: true,
        messageId: result.providerMessageId,
      });
    } else {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED" as any,
          failureReason: result.error || "Unknown error",
          providerResponse: (result.providerResponse as any) || undefined,
        } as any,
      });
      results.push({
        phone,
        success: false,
        error: result.error || "Send failed",
      });
    }

    // 100ms delay between sends (~10 msg/sec)
    await new Promise((r) => setTimeout(r, 100));
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.length - successCount;

  return ok(res, {
    total: results.length,
    successful: successCount,
    failed: failedCount,
    campaignName: campaignName || null,
    results,
  });
}


// ----------------------------------------------------------------
// POST /api/whatsapp/reminders/run - run reminders for current merchant
// Useful for testing or manual trigger.
// ----------------------------------------------------------------

export async function runRemindersHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const language = ((req.merchant.language as any) || "TR") as "TR" | "EN" | "AR";
  const result = await sendDueReminders(req.merchant.id, language);
  return ok(res, result);
}

// ----------------------------------------------------------------
// POST /api/whatsapp/reminders/run-all - cron-triggered, all merchants
// PROTECTED by CRON_SECRET header (compare against process.env.CRON_SECRET).
// Bypass authenticate middleware.
// ----------------------------------------------------------------

export async function runRemindersForAllHandler(req: Request, res: Response) {
  const provided = req.header("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || provided !== expected) {
    return fail(res, 403, "Forbidden");
  }
  const result = await runRemindersForAll();
  return ok(res, result);
}
