import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const invoiceController = {

  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { status, search, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (status) where.status = status;
      if (search) where.OR = [
        { customerName: { contains: search as string, mode: "insensitive" } },
        { invoiceNumber: { contains: search as string, mode: "insensitive" } },
      ];

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.status(200).json({ success: true, data: { invoices, total, page: parseInt(page as string), limit: parseInt(limit as string) } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get invoices" });
    }
  }),

  getById: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!invoice) { res.status(404).json({ success: false, error: "Invoice not found" }); return; }
      res.status(200).json({ success: true, data: invoice });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get invoice" });
    }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { customerName, customerEmail, customerPhone, customerTaxId, items, vatRate, currency, dueDate, notes } = req.body;

      if (!customerName || !items || !dueDate) {
        res.status(400).json({ success: false, error: "Missing required fields" }); return;
      }

      const count = await prisma.invoice.count({ where: { merchantId } });
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

      const subtotal = (items as any[]).reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0);
      const vat = parseFloat(vatRate || "20");
      const vatAmount = subtotal * (vat / 100);
      const total = subtotal + vatAmount;

      const invoice = await prisma.invoice.create({
        data: {
          merchantId, invoiceNumber, customerName,
          customerEmail, customerPhone, customerTaxId,
          items, subtotal, vatRate: vat, vatAmount, total,
          currency: currency || "TRY",
          dueDate: new Date(dueDate), notes,
        }
      });

      res.status(201).json({ success: true, data: invoice });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Failed to create invoice" });
    }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.invoice.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Invoice not found" }); return; }

      const invoice = await prisma.invoice.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.status(200).json({ success: true, data: invoice });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update invoice" });
    }
  }),

  markPaid: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.invoice.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Invoice not found" }); return; }

      const invoice = await prisma.invoice.update({
        where: { id: req.params.id },
        data: { status: "PAID", paidDate: new Date() },
      });
      res.status(200).json({ success: true, data: invoice });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to mark invoice as paid" });
    }
  }),

  delete: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.invoice.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Invoice not found" }); return; }

      await prisma.invoice.delete({ where: { id: req.params.id } });
      res.status(200).json({ success: true, message: "Invoice deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to delete invoice" });
    }
  }),
};
