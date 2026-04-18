// ================================================================
// Zyrix FinSuite — Taksit & Vade Takibi Controller (Feature 7)
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const installmentController = {

  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { overdue } = req.query;
      const merchantId = req.merchant!.id;
      const plans = await prisma.installmentPlan.findMany({
        where: { merchantId },
        include: { installments: { orderBy: { installmentNo: "asc" } }, invoice: { select: { invoiceNumber: true, status: true } } },
        orderBy: { createdAt: "desc" },
      });

      // Vadesi geçmiş taksitleri işaretle
      const now = new Date();
      const enriched = plans.map(plan => {
        const overdueCount = plan.installments.filter(i => i.status === "PENDING" && new Date(i.dueDate) < now).length;
        const paidCount = plan.installments.filter(i => i.status === "PAID").length;
        return { ...plan, overdueCount, paidCount, completionRate: Math.round((paidCount / plan.installmentCount) * 100) };
      });

      const result = overdue ? enriched.filter(p => p.overdueCount > 0) : enriched;
      res.json({ success: true, data: { plans: result, total: result.length } });
    } catch { res.status(500).json({ success: false, error: "Taksit planları alınamadı" }); }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { invoiceId, installmentCount, firstDueDate, notes } = req.body;
      if (!invoiceId || !installmentCount || !firstDueDate)
        return res.status(400).json({ success: false, error: "Fatura, taksit sayısı ve ilk vade zorunlu" });

      const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, merchantId: req.merchant!.id } });
      if (!invoice) return res.status(404).json({ success: false, error: "Fatura bulunamadı" });

      const existing = await prisma.installmentPlan.findUnique({ where: { invoiceId } });
      if (existing) return res.status(409).json({ success: false, error: "Bu fatura için zaten taksit planı var" });

      const totalAmount = Number(invoice.total);
      const installmentAmount = parseFloat((totalAmount / installmentCount).toFixed(2));
      const firstDate = new Date(firstDueDate);

      const plan = await prisma.installmentPlan.create({
        data: {
          merchantId: req.merchant!.id, invoiceId,
          customerName: invoice.customerName,
          customerPhone: invoice.customerPhone,
          totalAmount, currency: invoice.currency, installmentCount,
          firstDueDate: firstDate, notes,
          installments: {
            create: Array.from({ length: installmentCount }, (_, i) => {
              const d = new Date(firstDate);
              d.setMonth(d.getMonth() + i);
              const isLast = i === installmentCount - 1;
              // Son taksitte yuvarlama farkını düzelt
              const amt = isLast ? parseFloat((totalAmount - installmentAmount * (installmentCount - 1)).toFixed(2)) : installmentAmount;
              return { installmentNo: i + 1, amount: amt, dueDate: d };
            }),
          },
        },
        include: { installments: true },
      });

      res.status(201).json({ success: true, data: plan, message: `${installmentCount} taksitli plan oluşturuldu` });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: "Plan oluşturulamadı" });
    }
  }),

  payInstallment: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { installmentId } = req.params;
      const installment = await prisma.installment.findFirst({
        where: { id: installmentId },
        include: { plan: { select: { merchantId: true, customerName: true, installmentCount: true, installments: true } } },
      });
      if (!installment || installment.plan.merchantId !== req.merchant!.id)
        return res.status(404).json({ success: false, error: "Taksit bulunamadı" });
      if (installment.status === "PAID")
        return res.status(400).json({ success: false, error: "Bu taksit zaten ödendi" });

      const updated = await prisma.installment.update({
        where: { id: installmentId },
        data: { status: "PAID", paidDate: new Date() },
      });

      const allPaid = installment.plan.installments.every(i => i.id === installmentId || i.status === "PAID");
      if (allPaid) {
        await prisma.notification.create({
          data: { merchantId: req.merchant!.id, title: `✅ Taksit Planı Tamamlandı`, body: `${installment.plan.customerName} müşterisinin tüm ${installment.plan.installmentCount} taksiti ödendi.`, type: "SUCCESS" },
        });
      }

      res.json({ success: true, data: updated, message: `${installment.installmentNo}. taksit ödendi`, allPaid });
    } catch { res.status(500).json({ success: false, error: "Ödeme kaydedilemedi" }); }
  }),

  upcoming: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      const installments = await prisma.installment.findMany({
        where: { plan: { merchantId }, status: "PENDING", dueDate: { lte: nextWeek } },
        include: { plan: { select: { customerName: true, customerPhone: true } } },
        orderBy: { dueDate: "asc" },
      });
      res.json({ success: true, data: { installments, count: installments.length } });
    } catch { res.status(500).json({ success: false, error: "Yaklaşan taksitler alınamadı" }); }
  }),
};