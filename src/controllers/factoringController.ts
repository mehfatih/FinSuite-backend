// ================================================================
// Zyrix FinSuite — Invoice Factoring Controller
// Bekleyen faturalar karşılığı erken finansman sistemi
// ================================================================

import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Factoring Hesaplama ──────────────────────────────────────
function calculateFactoring(invoiceAmount: number, advanceRate = 80, feeRate = 2.5) {
  const requestedAmount = invoiceAmount * (advanceRate / 100);
  const feeAmount = requestedAmount * (feeRate / 100);
  const netAmount = requestedAmount - feeAmount;
  return { requestedAmount, feeAmount, netAmount };
}

export const factoringController = {

  // ── GET /api/factoring — tüm factoring talepleri
  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { status, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (status) where.status = status;

      const [requests, total] = await Promise.all([
        prisma.factoringRequest.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
          include: {
            invoice: {
              select: {
                invoiceNumber: true, customerName: true,
                total: true, dueDate: true, status: true,
              },
            },
          },
        }),
        prisma.factoringRequest.count({ where }),
      ]);

      // Özet istatistikler
      const totalFunded = await prisma.factoringRequest.aggregate({
        where: { merchantId, status: "FUNDED" },
        _sum: { netAmount: true },
      });

      res.status(200).json({
        success: true,
        data: {
          requests, total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalFundedAmount: totalFunded._sum.netAmount || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Factoring talepleri alınamadı" });
    }
  }),

  // ── POST /api/factoring/calculate — hesapla (talep oluşturmadan)
  calculate: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        res.status(400).json({ success: false, error: "invoiceId zorunlu" });
        return;
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, merchantId: req.merchant!.id },
      });

      if (!invoice) {
        res.status(404).json({ success: false, error: "Fatura bulunamadı" });
        return;
      }

      if (invoice.status === "PAID") {
        res.status(400).json({ success: false, error: "Ödenmiş fatura için finansman talep edilemez" });
        return;
      }

      const invoiceAmount = Number(invoice.total);
      const calc = calculateFactoring(invoiceAmount);

      res.status(200).json({
        success: true,
        data: {
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerName: invoice.customerName,
            total: invoiceAmount,
            dueDate: invoice.dueDate,
            currency: invoice.currency,
          },
          calculation: {
            invoiceAmount,
            advanceRate: 80,
            requestedAmount: calc.requestedAmount,
            feeRate: 2.5,
            feeAmount: calc.feeAmount,
            netAmount: calc.netAmount,
            currency: invoice.currency,
          },
          info: {
            processingTime: "24-48 saat",
            partner: "Zyrix Finance",
            note: "Onay sonrası para hesabınıza aktarılır. Fatura tahsilinde kalan tutar iade edilir.",
          },
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Hesaplama başarısız" });
    }
  }),

  // ── POST /api/factoring/apply — factoring talebi oluştur
  apply: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { invoiceId, notes } = req.body;

      if (!invoiceId) {
        res.status(400).json({ success: false, error: "invoiceId zorunlu" });
        return;
      }

      // Fatura kontrolü
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, merchantId },
      });
      if (!invoice) {
        res.status(404).json({ success: false, error: "Fatura bulunamadı" });
        return;
      }
      if (invoice.status === "PAID" || invoice.status === "CANCELLED") {
        res.status(400).json({ success: false, error: "Bu fatura için finansman talep edilemez" });
        return;
      }

      // Zaten talep var mı?
      const existingRequest = await prisma.factoringRequest.findUnique({
        where: { invoiceId },
      });
      if (existingRequest) {
        res.status(409).json({
          success: false,
          error: "Bu fatura için zaten bir finansman talebi mevcut",
          data: { id: existingRequest.id, status: existingRequest.status },
        });
        return;
      }

      const invoiceAmount = Number(invoice.total);
      const calc = calculateFactoring(invoiceAmount);

      const factoringRequest = await prisma.factoringRequest.create({
        data: {
          merchantId, invoiceId,
          invoiceAmount,
          requestedAmount: calc.requestedAmount,
          advanceRate: 80,
          feeRate: 2.5,
          feeAmount: calc.feeAmount,
          netAmount: calc.netAmount,
          status: "PENDING",
          notes,
        },
        include: {
          invoice: {
            select: { invoiceNumber: true, customerName: true, total: true, dueDate: true },
          },
        },
      });

      // Bildirim gönder
      await prisma.notification.create({
        data: {
          merchantId,
          title: "Finansman Talebiniz Alındı 💰",
          body: `${invoice.customerName} müşterinizin ${Number(invoice.total).toLocaleString("tr-TR")} TL tutarlı faturası için finansman talebiniz alındı. 24-48 saat içinde değerlendirilecek.`,
          type: "INFO",
        },
      });

      res.status(201).json({
        success: true,
        data: factoringRequest,
        message: "Finansman talebiniz alındı. 24-48 saat içinde incelenerek size bildirim gönderilecek.",
      });
    } catch (err) {
      console.error("[Factoring apply]", err);
      res.status(500).json({ success: false, error: "Talep oluşturulamadı" });
    }
  }),

  // ── GET /api/factoring/:id — tekil talep detayı
  getById: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const request = await prisma.factoringRequest.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: {
          invoice: {
            select: {
              invoiceNumber: true, customerName: true, customerEmail: true,
              total: true, dueDate: true, status: true, currency: true,
            },
          },
        },
      });
      if (!request) {
        res.status(404).json({ success: false, error: "Talep bulunamadı" });
        return;
      }
      res.status(200).json({ success: true, data: request });
    } catch (err) {
      res.status(500).json({ success: false, error: "Talep alınamadı" });
    }
  }),

  // ── POST /api/factoring/:id/cancel — talebi iptal et
  cancel: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const request = await prisma.factoringRequest.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!request) {
        res.status(404).json({ success: false, error: "Talep bulunamadı" });
        return;
      }
      if (!["PENDING"].includes(request.status)) {
        res.status(400).json({ success: false, error: "Sadece bekleyen talepler iptal edilebilir" });
        return;
      }
      const updated = await prisma.factoringRequest.update({
        where: { id: req.params.id },
        data: { status: "REJECTED", rejectionReason: "Kullanıcı tarafından iptal edildi" },
      });
      res.status(200).json({ success: true, data: updated, message: "Talep iptal edildi" });
    } catch (err) {
      res.status(500).json({ success: false, error: "İptal başarısız" });
    }
  }),

  // ── GET /api/factoring/eligible — factoring için uygun faturalar
  eligibleInvoices: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;

      // Factoring talebi olmayan, ödenmemiş faturalar
      const factoredInvoiceIds = (await prisma.factoringRequest.findMany({
        where: { merchantId },
        select: { invoiceId: true },
      })).map(r => r.invoiceId);

      const invoices = await prisma.invoice.findMany({
        where: {
          merchantId,
          status: { in: ["SENT", "OVERDUE", "DRAFT"] },
          id: { notIn: factoredInvoiceIds },
          total: { gt: 1000 }, // Min 1000 TL
        },
        orderBy: { total: "desc" },
        take: 20,
      });

      const enriched = invoices.map(inv => {
        const amount = Number(inv.total);
        const calc = calculateFactoring(amount);
        return {
          ...inv,
          factoringEstimate: {
            netAmount: calc.netAmount,
            feeAmount: calc.feeAmount,
            advanceRate: 80,
          },
        };
      });

      res.status(200).json({
        success: true,
        data: {
          invoices: enriched,
          total: enriched.length,
          info: "Minimum fatura tutarı 1.000 TL. %80 avans, %2.5 komisyon.",
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Uygun faturalar alınamadı" });
    }
  }),
};