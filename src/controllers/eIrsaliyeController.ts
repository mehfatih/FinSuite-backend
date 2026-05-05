// ============================================================
// Zyrix FinSuite - e-Irsaliye Controller
// Sprint 1 Phase 1A
//
// Endpoints (all authenticated):
//   POST   /api/eirsaliye         create
//   GET    /api/eirsaliye         list (filterable by status)
//   GET    /api/eirsaliye/:id     get one
//   PATCH  /api/eirsaliye/:id     update (only DRAFT)
//   POST   /api/eirsaliye/:id/queue   build XML + queue for GIB
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import * as crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  buildEIrsaliyeXml,
  computeTotals,
  EIrsaliyeLineItem,
} from "../services/eIrsaliyeXmlService";

// ----------------------------------------------------------------
// Auth shape (matches the rest of the codebase)
// ----------------------------------------------------------------
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

const lineItemSchema = z.object({
  productCode: z.string().max(100).optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unitCode: z.string().max(10).optional(),
  unitPrice: z.number().nonnegative().optional(),
  vatRate: z.number().min(0).max(1).optional(),
  notes: z.string().max(500).optional(),
});

const createSchema = z.object({
  irsaliyeNo: z.string().trim().min(1).max(40).optional(),
  irsaliyeType: z.string().max(20).optional(),
  buyerVkn: z.string().trim().max(11).optional(),
  buyerTitle: z.string().trim().min(1).max(200),
  buyerAddress: z.string().max(500).optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryDate: z.coerce.date().optional(),
  vehiclePlate: z.string().max(20).optional(),
  driverName: z.string().max(100).optional(),
  driverTcKimlik: z.string().max(11).optional(),
  items: z.array(lineItemSchema).min(1, "At least one line item is required"),
  currency: z.string().length(3).optional(),
  notes: z.string().max(1000).optional(),
});

const updateSchema = createSchema.partial();

const listSchema = z.object({
  status: z
    .enum([
      "DRAFT",
      "READY_TO_SEND",
      "QUEUED",
      "SENT_PENDING_GIB",
      "ACCEPTED",
      "REJECTED",
      "CANCELLED",
    ])
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

function generateIrsaliyeNo(): string {
  // Format: ZRX{YYYY}{9 random digits} - matches GIB recommendation
  // of 16-character alphanumeric prefixed with merchant code.
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1e9).toString().padStart(9, "0");
  return "ZRX" + year + rand;
}

// ----------------------------------------------------------------
// POST /api/eirsaliye - create a draft
// ----------------------------------------------------------------

export async function createHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  // Compute totals from items
  const totals = computeTotals(input.items as EIrsaliyeLineItem[]);

  const irsaliyeNo = input.irsaliyeNo || generateIrsaliyeNo();

  try {
    const created = await prisma.eIrsaliye.create({
      data: {
        merchantId: req.merchant.id,
        irsaliyeNo,
        irsaliyeType: input.irsaliyeType || "SEVK",
        status: "DRAFT" as any,
        buyerVkn: input.buyerVkn || null,
        buyerTitle: input.buyerTitle,
        buyerAddress: input.buyerAddress || null,
        deliveryAddress: input.deliveryAddress || null,
        deliveryDate: input.deliveryDate || null,
        vehiclePlate: input.vehiclePlate || null,
        driverName: input.driverName || null,
        driverTcKimlik: input.driverTcKimlik || null,
        items: input.items as any,
        totalAmount: new Prisma.Decimal(totals.grandTotal),
        currency: input.currency || "TRY",
        notes: input.notes || null,
      } as any,
    });

    return ok(res, created, 201);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return fail(res, 409, "irsaliyeNo already exists");
    }
    // eslint-disable-next-line no-console
    console.error("[eirsaliye create] error:", err);
    return fail(res, 500, "Failed to create e-Irsaliye");
  }
}

// ----------------------------------------------------------------
// GET /api/eirsaliye - list
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
    prisma.eIrsaliye.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ?? 50,
      skip: offset ?? 0,
    }),
    prisma.eIrsaliye.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /api/eirsaliye/:id
// ----------------------------------------------------------------

export async function getHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const row = await prisma.eIrsaliye.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!row) return fail(res, 404, "Not found");

  return ok(res, row);
}

// ----------------------------------------------------------------
// PATCH /api/eirsaliye/:id - update (DRAFT only)
// ----------------------------------------------------------------

export async function updateHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  // Verify ownership and DRAFT status
  const existing = await prisma.eIrsaliye.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Not found");
  if (String(existing.status) !== "DRAFT") {
    return fail(res, 409, "Only DRAFT documents can be edited");
  }

  // If items changed, recompute totals
  let totalAmount: Prisma.Decimal | undefined;
  if (input.items) {
    const totals = computeTotals(input.items as EIrsaliyeLineItem[]);
    totalAmount = new Prisma.Decimal(totals.grandTotal);
  }

  const data: any = {};
  if (input.irsaliyeType !== undefined) data.irsaliyeType = input.irsaliyeType;
  if (input.buyerVkn !== undefined) data.buyerVkn = input.buyerVkn || null;
  if (input.buyerTitle !== undefined) data.buyerTitle = input.buyerTitle;
  if (input.buyerAddress !== undefined) data.buyerAddress = input.buyerAddress || null;
  if (input.deliveryAddress !== undefined) data.deliveryAddress = input.deliveryAddress || null;
  if (input.deliveryDate !== undefined) data.deliveryDate = input.deliveryDate || null;
  if (input.vehiclePlate !== undefined) data.vehiclePlate = input.vehiclePlate || null;
  if (input.driverName !== undefined) data.driverName = input.driverName || null;
  if (input.driverTcKimlik !== undefined) data.driverTcKimlik = input.driverTcKimlik || null;
  if (input.items !== undefined) {
    data.items = input.items as any;
    if (totalAmount) data.totalAmount = totalAmount;
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.notes !== undefined) data.notes = input.notes || null;

  const updated = await prisma.eIrsaliye.update({
    where: { id },
    data,
  });

  return ok(res, updated);
}

// ----------------------------------------------------------------
// POST /api/eirsaliye/:id/queue - build XML and queue for GIB
// (no actual GIB submission - status moves to SENT_PENDING_GIB)
// ----------------------------------------------------------------

export async function queueHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  // Load merchant + e-Irsaliye in parallel
  const [doc, merchant] = await Promise.all([
    prisma.eIrsaliye.findFirst({
      where: { id, merchantId: req.merchant.id },
    }),
    prisma.merchant.findUnique({
      where: { id: req.merchant.id },
    }),
  ]);

  if (!doc) return fail(res, 404, "Not found");
  if (!merchant) return fail(res, 404, "Merchant not found");

  // State machine: only DRAFT or READY_TO_SEND can be queued
  const status = String(doc.status);
  if (status !== "DRAFT" && status !== "READY_TO_SEND") {
    return fail(
      res,
      409,
      "Document cannot be queued from status " + status
    );
  }

  // Sender VKN / title from merchant business profile
  const senderVkn = (merchant as any).businessVkn || (merchant as any).vkn;
  if (!senderVkn) {
    return fail(
      res,
      422,
      "Merchant has no VKN/tax number. Update business profile before queueing."
    );
  }

  const senderTitle =
    (merchant as any).businessName ||
    (merchant as any).name ||
    "Zyrix Customer";

  // Build the UBL-TR XML
  const uuid = crypto.randomUUID();
  let xml: string;
  try {
    xml = buildEIrsaliyeXml({
      irsaliyeNo: doc.irsaliyeNo,
      uuid,
      issueDate: new Date(),
      sender: {
        vkn: String(senderVkn),
        title: String(senderTitle),
        address: (merchant as any).businessAddress || undefined,
        country: "Turkiye",
      },
      receiver: {
        vkn: doc.buyerVkn || undefined,
        title: doc.buyerTitle || "Customer",
        address: doc.buyerAddress || undefined,
        country: "Turkiye",
      },
      delivery: {
        address: doc.deliveryAddress || undefined,
        deliveryDate: doc.deliveryDate || undefined,
        vehiclePlate: doc.vehiclePlate || undefined,
        driverName: doc.driverName || undefined,
        driverTcKimlik: doc.driverTcKimlik || undefined,
      },
      items: (doc.items as any) as EIrsaliyeLineItem[],
      currency: doc.currency,
      notes: doc.notes || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "XML build failed";
    return fail(res, 422, message);
  }

  // Persist: status -> SENT_PENDING_GIB (queue for later GIB submission)
  const now = new Date();
  const updated = await prisma.eIrsaliye.update({
    where: { id },
    data: {
      xmlContent: xml,
      gibUUID: uuid,
      status: "SENT_PENDING_GIB" as any,
      queuedAt: now,
    } as any,
  });

  return ok(res, {
    eIrsaliye: updated,
    xmlPreview: xml.substring(0, 800) + (xml.length > 800 ? "..." : ""),
    note:
      "Document is queued. Actual GIB submission will run when integrator credentials are configured.",
  });
}
