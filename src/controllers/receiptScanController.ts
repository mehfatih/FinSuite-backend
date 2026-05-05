// ============================================================
// Zyrix FinSuite - Receipt Scan Controller
// Sprint 1 Phase 1A - Feature 2
//
// Endpoints (all authenticated):
//   POST   /api/receipts/scan         scan + auto-create expense
//   GET    /api/receipts              list scans
//   GET    /api/receipts/:id          get one
//   DELETE /api/receipts/:id          delete a scan record
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { scanReceipt } from "../services/receiptScanService";

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
    language?: string;
    currency?: string;
  };
}

// ----------------------------------------------------------------
// Zod schemas
// ----------------------------------------------------------------

const scanSchema = z.object({
  imageBase64: z
    .string()
    .min(100, "Image data is too small or missing"),
  mimeType: z.string().max(40).optional(),
  autoCreateExpense: z.boolean().optional().default(true),
});

const listSchema = z.object({
  status: z
    .enum(["PENDING", "PROCESSING", "PARSED", "FAILED", "CONVERTED"])
    .optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /api/receipts/scan
// ----------------------------------------------------------------

export async function scanHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { imageBase64, mimeType, autoCreateExpense } = parsed.data;

  // 1. Insert PENDING row first - so we always have a record
  //    even if Gemini fails or times out.
  const initial = await prisma.receiptScan.create({
    data: {
      merchantId: req.merchant.id,
      status: "PROCESSING" as any,
      // We do NOT persist the full base64 in the DB row to keep the
      // table light. imageBase64 is processed in-memory only. If the
      // user wants permanent storage, they can use the upload pipeline
      // (out of scope for this milestone).
    } as any,
  });

  // 2. Call Gemini Vision
  const result = await scanReceipt(imageBase64, mimeType || "image/jpeg");

  if (!result.success || !result.data) {
    const failed = await prisma.receiptScan.update({
      where: { id: initial.id },
      data: {
        status: "FAILED" as any,
        failureReason: result.error || "Unknown parse error",
      } as any,
    });
    return fail(res, 422, result.error || "Receipt parsing failed");
  }

  const d = result.data;

  // 3. Persist the parsed data
  const updated = await prisma.receiptScan.update({
    where: { id: initial.id },
    data: {
      status: "PARSED" as any,
      parsedVendor:      d.vendor || null,
      parsedAmount:      d.amount !== null && d.amount !== undefined
        ? new Prisma.Decimal(d.amount)
        : null,
      parsedCurrency:    d.currency || "TRY",
      parsedDate:        d.date ? new Date(d.date) : null,
      parsedCategory:    d.category || null,
      parsedDescription: d.description || null,
      parsedTaxAmount:   d.taxAmount !== null && d.taxAmount !== undefined
        ? new Prisma.Decimal(d.taxAmount)
        : null,
      parsedTaxRate:     d.taxRate !== null && d.taxRate !== undefined
        ? new Prisma.Decimal(d.taxRate)
        : null,
      parsedRawJson:     d as any,
    } as any,
  });

  // 4. Optionally auto-create an Expense entry (default ON)
  let createdExpense: any = null;
  if (autoCreateExpense && d.amount && d.amount > 0) {
    try {
      createdExpense = await prisma.expense.create({
        data: {
          merchantId: req.merchant.id,
          category: d.category || "other",
          description:
            d.description ||
            (d.vendor ? "Receipt from " + d.vendor : "Receipt scan"),
          amount: new Prisma.Decimal(d.amount),
          currency: (d.currency || "TRY"),
          date: d.date ? new Date(d.date) : new Date(),
        } as any,
      });

      // Link the scan to the created expense
      await prisma.receiptScan.update({
        where: { id: initial.id },
        data: {
          status: "CONVERTED" as any,
          convertedExpenseId: createdExpense.id,
        } as any,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[receiptScan] auto-expense creation failed:", err);
    }
  }

  // 5. Return enriched payload
  return ok(
    res,
    {
      receiptScan: updated,
      expense: createdExpense,
      parsed: d,
    },
    201
  );
}

// ----------------------------------------------------------------
// GET /api/receipts - list
// ----------------------------------------------------------------

export async function listHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }
  const { status, limit, offset } = parsed.data;

  const where: any = { merchantId: req.merchant.id };
  if (status) where.status = status;

  const [rows, total] = await Promise.all([
    prisma.receiptScan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ?? 50,
      skip: offset ?? 0,
    }),
    prisma.receiptScan.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /api/receipts/:id
// ----------------------------------------------------------------

export async function getHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const row = await prisma.receiptScan.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!row) return fail(res, 404, "Not found");

  return ok(res, row);
}

// ----------------------------------------------------------------
// DELETE /api/receipts/:id
// ----------------------------------------------------------------

export async function deleteHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const existing = await prisma.receiptScan.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Not found");

  // Note: we do NOT delete the linked Expense entry - the user may
  // have edited it. Just delete the scan record.
  await prisma.receiptScan.delete({ where: { id } });

  return ok(res, { id, deleted: true });
}
