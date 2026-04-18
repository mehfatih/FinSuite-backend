// ================================================================
// Zyrix FinSuite — Abonelik Faturalandırma Controller (Feature 12)
// Otomatik tekrarlayan fatura oluşturma
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

async function generateInvoiceFromRecurring(recurring: any, merchantId: string) {
  const count = await prisma.invoice.count({ where: { merchantId } });
  const invoiceNumber = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  return prisma.invoice.create({
    data: {
      merchantId, invoiceNumber,
      customerName: recurring.customerName,
      customerEmail: recurring.customerEmail,
      customerPhone: recurring.customerPhone,
      items: recurring.items,
      subtotal: recurring.subtotal, vatRate: recurring.vatRate,
      vatAmount: recurring.vatAmount, total: recurring.total,
      currency: recurring.currency, status: "SENT",
      dueDate: new Date(Date.now() + 30 * 86400000), // 30 gün vade
      notes: `Otomatik tekrarlayan fatura — ${recurring.id}`,
    },
  });
}

export const recurringController = {

  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const recurring = await prisma.recurringInvoice.findMany({
        where: { merchantId: req.merchant!.id },
        orderBy: { nextRunDate: "asc" },
      });
      res.json({ success: true, data: { recurring, total: recurring.length } });
    } catch { res.status(500).json({ success: false, error: "Liste alınamadı" }); }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerName, customerEmail, customerPhone, items, vatRate = 20, currency = "TRY", interval = "MONTHLY", dayOfMonth = 1, startDate, endDate, notes } = req.body;
      if (!customerName || !items || !startDate) return res.status(400).json({ success: false, error: "Müşteri adı, ürünler ve başlangıç tarihi zorunlu" });

      const subtotal = (items as any[]).reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0);
      const vatAmount = subtotal * (vatRate / 100);
      const total = subtotal + vatAmount;

      const start = new Date(startDate);
      const nextRun = new Date(start);
      nextRun.setDate(dayOfMonth);

      const recurring = await prisma.recurringInvoice.create({
        data: {
          merchantId: req.merchant!.id, customerName, customerEmail, customerPhone, items,
          subtotal, vatRate, vatAmount, total, currency, interval,
          dayOfMonth, startDate: start, endDate: endDate ? new Date(endDate) : null,
          nextRunDate: nextRun, notes,
        },
      });
      res.status(201).json({ success: true, data: recurring });
    } catch { res.status(500).json({ success: false, error: "Plan oluşturulamadı" }); }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!existing) return res.status(404).json({ success: false, error: "Plan bulunamadı" });
      const { status } = req.body;
      const updated = await prisma.recurringInvoice.update({ where: { id: req.params.id }, data: { status } });
      res.json({ success: true, data: updated });
    } catch { res.status(500).json({ success: false, error: "Güncelleme başarısız" }); }
  }),

  // ── POST /api/recurring/:id/run — manuel tetikle
  runNow: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const recurring = await prisma.recurringInvoice.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!recurring) return res.status(404).json({ success: false, error: "Plan bulunamadı" });
      if (recurring.status !== "ACTIVE") return res.status(400).json({ success: false, error: "Plan aktif değil" });

      const invoice = await generateInvoiceFromRecurring(recurring, req.merchant!.id);

      const next = new Date(recurring.nextRunDate);
      if (recurring.interval === "MONTHLY") next.setMonth(next.getMonth() + 1);
      else next.setFullYear(next.getFullYear() + 1);

      await prisma.recurringInvoice.update({
        where: { id: recurring.id },
        data: { lastRunDate: new Date(), nextRunDate: next, runCount: { increment: 1 } },
      });

      res.json({ success: true, data: { invoice }, message: `Fatura oluşturuldu: ${invoice.invoiceNumber}` });
    } catch { res.status(500).json({ success: false, error: "Fatura oluşturulamadı" }); }
  }),

  // ── POST /api/recurring/process-due — cron job endpoint (tüm vadesi gelenleri işle)
  processDue: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const due = await prisma.recurringInvoice.findMany({
        where: { merchantId: req.merchant!.id, status: "ACTIVE", nextRunDate: { lte: new Date() } },
      });
      let processed = 0;
      for (const r of due) {
        try {
          await generateInvoiceFromRecurring(r, req.merchant!.id);
          const next = new Date(r.nextRunDate);
          if (r.interval === "MONTHLY") next.setMonth(next.getMonth() + 1);
          else next.setFullYear(next.getFullYear() + 1);
          await prisma.recurringInvoice.update({ where: { id: r.id }, data: { lastRunDate: new Date(), nextRunDate: next, runCount: { increment: 1 } } });
          processed++;
        } catch { /* devam et */ }
      }
      res.json({ success: true, data: { processed, total: due.length } });
    } catch { res.status(500).json({ success: false, error: "İşlem başarısız" }); }
  }),
};