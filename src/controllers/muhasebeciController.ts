// ================================================================
// Zyrix FinSuite — Muhasebeci (Accountant) Integration Controller
// Muhasebeciye sınırlı, güvenli erişim sağlama sistemi
// ================================================================

import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";
import { Request } from "express";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const muhasebeciController = {

  // ── GET /api/muhasebeci — tüm muhasebeci linkleri
  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const links = await prisma.muhasebeciLink.findMany({
        where: { merchantId: req.merchant!.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, email: true, accessLevel: true,
          isActive: true, expiresAt: true, lastAccessAt: true,
          permissions: true, notes: true, createdAt: true,
          // Token güvenlik için maskeliyoruz
          accessToken: true,
        },
      });

      // Token'ı maskele — sadece ilk/son 4 karakter göster
      const safeLinks = links.map(l => ({
        ...l,
        accessTokenMasked: `${l.accessToken.slice(0, 4)}...${l.accessToken.slice(-4)}`,
        accessLink: `${process.env.FRONTEND_URL || "https://finsuite.zyrix.co"}/muhasebeci/${l.accessToken}`,
      }));

      res.status(200).json({ success: true, data: { links: safeLinks } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Muhasebeci listesi alınamadı" });
    }
  }),

  // ── POST /api/muhasebeci — yeni muhasebeci linki oluştur
  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { name, email, accessLevel = "READ_ONLY", expiresAt, permissions, notes } = req.body;

      if (!name || !email) {
        res.status(400).json({ success: false, error: "İsim ve e-posta zorunlu" });
        return;
      }

      // Aynı email'e zaten link var mı?
      const existing = await prisma.muhasebeciLink.findFirst({
        where: { merchantId, email, isActive: true },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          error: "Bu e-posta için zaten aktif bir muhasebeci erişimi var",
          data: { id: existing.id },
        });
        return;
      }

      const link = await prisma.muhasebeciLink.create({
        data: {
          merchantId, name, email,
          accessLevel: accessLevel as any,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          permissions: permissions || {
            invoices: true,
            expenses: true,
            deals: false,
            customers: false,
          },
          notes,
        },
      });

      const accessLink = `${process.env.FRONTEND_URL || "https://finsuite.zyrix.co"}/muhasebeci/${link.accessToken}`;

      res.status(201).json({
        success: true,
        data: {
          ...link,
          accessLink,
          message: `${name} için muhasebeci erişim linki oluşturuldu. Linki muhasebecine ilet.`,
        },
      });
    } catch (err) {
      console.error("[Muhasebeci create]", err);
      res.status(500).json({ success: false, error: "Muhasebeci linki oluşturulamadı" });
    }
  }),

  // ── PUT /api/muhasebeci/:id — erişim güncelle
  update: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.muhasebeciLink.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Muhasebeci linki bulunamadı" });
        return;
      }

      const { accessLevel, isActive, expiresAt, permissions, notes } = req.body;

      const updated = await prisma.muhasebeciLink.update({
        where: { id: req.params.id },
        data: {
          ...(accessLevel !== undefined && { accessLevel }),
          ...(isActive !== undefined && { isActive }),
          ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
          ...(permissions !== undefined && { permissions }),
          ...(notes !== undefined && { notes }),
        },
      });
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: "Güncelleme başarısız" });
    }
  }),

  // ── DELETE /api/muhasebeci/:id — erişimi iptal et
  revoke: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.muhasebeciLink.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: "Muhasebeci linki bulunamadı" });
        return;
      }
      await prisma.muhasebeciLink.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      res.status(200).json({ success: true, message: "Muhasebeci erişimi iptal edildi" });
    } catch (err) {
      res.status(500).json({ success: false, error: "İptal işlemi başarısız" });
    }
  }),

  // ── GET /api/muhasebeci/access/:token — muhasebeci erişim noktası
  // Bu endpoint JWT gerektirmez — token bazlı güvenlik
  access: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      const link = await prisma.muhasebeciLink.findUnique({
        where: { accessToken: token },
        include: {
          merchant: {
            select: { id: true, name: true, businessName: true, currency: true },
          },
        },
      });

      if (!link || !link.isActive) {
        res.status(403).json({ success: false, error: "Geçersiz veya devre dışı erişim linki" });
        return;
      }

      // Süre kontrolü
      if (link.expiresAt && link.expiresAt < new Date()) {
        res.status(403).json({ success: false, error: "Erişim süresi dolmuş" });
        return;
      }

      // Son erişim tarihini güncelle
      await prisma.muhasebeciLink.update({
        where: { accessToken: token },
        data: { lastAccessAt: new Date() },
      });

      const perms = link.permissions as any;
      const merchantId = link.merchant.id;

      // İzinlere göre veri getir
      const [invoices, expenses] = await Promise.all([
        perms?.invoices !== false
          ? prisma.invoice.findMany({
              where: { merchantId },
              orderBy: { createdAt: "desc" },
              take: 100,
              select: {
                id: true, invoiceNumber: true, customerName: true,
                customerTaxId: true, subtotal: true, vatRate: true,
                vatAmount: true, total: true, currency: true,
                status: true, dueDate: true, paidDate: true, createdAt: true,
              },
            })
          : [],
        perms?.expenses !== false
          ? prisma.expense.findMany({
              where: { merchantId },
              orderBy: { date: "desc" },
              take: 100,
            })
          : [],
      ]);

      res.status(200).json({
        success: true,
        data: {
          merchant: link.merchant,
          accessLevel: link.accessLevel,
          permissions: link.permissions,
          invoices,
          expenses,
          exportedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Veri alınamadı" });
    }
  }),

  // ── GET /api/muhasebeci/export/:token — Excel/CSV export
  export: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;
      const { format = "csv", type = "invoices" } = req.query;

      const link = await prisma.muhasebeciLink.findUnique({
        where: { accessToken: token },
      });

      if (!link || !link.isActive) {
        res.status(403).json({ success: false, error: "Geçersiz erişim" });
        return;
      }

      if (link.accessLevel === "READ_ONLY") {
        res.status(403).json({ success: false, error: "Export yetkisi yok (READ_ONLY erişim)" });
        return;
      }

      const merchantId = link.merchantId;

      if (type === "invoices") {
        const invoices = await prisma.invoice.findMany({
          where: { merchantId },
          orderBy: { createdAt: "desc" },
        });

        if (format === "csv") {
          const header = "Fatura No,Müşteri,Vergi No,Ara Toplam,KDV,Toplam,Para Birimi,Durum,Vade,Oluşturma Tarihi\n";
          const rows = invoices.map(inv =>
            [
              inv.invoiceNumber, inv.customerName, inv.customerTaxId || "",
              inv.subtotal, inv.vatAmount, inv.total, inv.currency,
              inv.status, new Date(inv.dueDate).toLocaleDateString("tr-TR"),
              new Date(inv.createdAt).toLocaleDateString("tr-TR"),
            ].join(",")
          ).join("\n");

          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="faturalar-${Date.now()}.csv"`);
          res.send("\uFEFF" + header + rows); // BOM for Turkish chars
          return;
        }
      }

      res.status(400).json({ success: false, error: "Desteklenmeyen format" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Export başarısız" });
    }
  }),
};