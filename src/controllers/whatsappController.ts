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

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
  };
}

const sendInvoiceSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(20).optional(),
  customMessage: z.string().max(1000).optional(),
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
