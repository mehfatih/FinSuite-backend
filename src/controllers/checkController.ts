// ================================================================
// Zyrix FinSuite — Çek & Senet Takibi Controller (Feature 8)
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const checkController = {

  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type, status, page = "1", limit = "30" } = req.query;
      const merchantId = req.merchant!.id;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const where: any = { merchantId };
      if (type) where.checkType = type;
      if (status) where.status = status;

      const [checks, total] = await Promise.all([
        prisma.check.findMany({ where, skip, take: parseInt(limit as string), orderBy: { dueDate: "asc" } }),
        prisma.check.count({ where }),
      ]);

      // Vadesi yaklaşan / geçmiş çekleri işaretle
      const now = new Date();
      const enriched = checks.map(c => ({
        ...c,
        isOverdue: c.status === "PENDING" && new Date(c.dueDate) < now,
        isDueSoon: c.status === "PENDING" && new Date(c.dueDate) > now && (new Date(c.dueDate).getTime() - now.getTime()) < 3 * 86400000,
      }));

      const stats = {
        totalReceived: checks.filter(c => c.checkType === "RECEIVED" && c.status === "PENDING").reduce((s, c) => s + Number(c.amount), 0),
        totalIssued: checks.filter(c => c.checkType === "ISSUED" && c.status === "PENDING").reduce((s, c) => s + Number(c.amount), 0),
        overdueCount: enriched.filter(c => c.isOverdue).length,
        dueSoonCount: enriched.filter(c => c.isDueSoon).length,
      };

      res.json({ success: true, data: { checks: enriched, total, stats } });
    } catch { res.status(500).json({ success: false, error: "Çekler alınamadı" }); }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { checkType, checkNumber, bankName, branchCode, accountName, amount, currency, dueDate, invoiceRef, notes } = req.body;
      if (!checkType || !checkNumber || !accountName || !amount || !dueDate)
        return res.status(400).json({ success: false, error: "Çek tipi, no, kişi adı, tutar ve vade zorunlu" });

      const check = await prisma.check.create({
        data: { merchantId: req.merchant!.id, checkType, checkNumber, bankName, branchCode, accountName, amount, currency: currency || "TRY", dueDate: new Date(dueDate), invoiceRef, notes },
      });

      // 3 gün öncesi hatırlatma için notification (ileride cron job)
      res.status(201).json({ success: true, data: check });
    } catch { res.status(500).json({ success: false, error: "Çek oluşturulamadı" }); }
  }),

  updateStatus: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, bounceReason } = req.body;
      const check = await prisma.check.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!check) return res.status(404).json({ success: false, error: "Çek bulunamadı" });

      const data: any = { status };
      if (status === "CLEARED") data.clearedDate = new Date();
      if (status === "BOUNCED") { data.bouncedDate = new Date(); data.bounceReason = bounceReason; }

      const updated = await prisma.check.update({ where: { id: req.params.id }, data });

      if (status === "BOUNCED") {
        await prisma.notification.create({
          data: { merchantId: req.merchant!.id, title: `🔴 Çek İade: ${check.accountName}`, body: `${check.accountName}'a ait ${Number(check.amount).toLocaleString("tr-TR")} TL tutarlı çek iade edildi. ${bounceReason || ""}`, type: "ERROR" },
        });
      }

      res.json({ success: true, data: updated });
    } catch { res.status(500).json({ success: false, error: "Durum güncellenemedi" }); }
  }),

  upcoming: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
      const checks = await prisma.check.findMany({
        where: { merchantId, status: "PENDING", dueDate: { lte: nextWeek } },
        orderBy: { dueDate: "asc" },
      });
      res.json({ success: true, data: { checks, count: checks.length } });
    } catch { res.status(500).json({ success: false, error: "Yaklaşan çekler alınamadı" }); }
  }),

  summary: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const [received, issued, bounced] = await Promise.all([
        prisma.check.aggregate({ where: { merchantId, checkType: "RECEIVED", status: "PENDING" }, _sum: { amount: true }, _count: true }),
        prisma.check.aggregate({ where: { merchantId, checkType: "ISSUED", status: "PENDING" }, _sum: { amount: true }, _count: true }),
        prisma.check.count({ where: { merchantId, status: "BOUNCED" } }),
      ]);
      res.json({ success: true, data: { received: { amount: received._sum.amount || 0, count: received._count }, issued: { amount: issued._sum.amount || 0, count: issued._count }, bouncedCount: bounced } });
    } catch { res.status(500).json({ success: false, error: "Özet alınamadı" }); }
  }),
};