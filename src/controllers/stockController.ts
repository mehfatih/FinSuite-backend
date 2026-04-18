// ================================================================
// Zyrix FinSuite — Stok Yönetimi Controller (Feature 6)
// CRUD + hareket takibi + düşük stok uyarısı
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const stockController = {

  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { search, category, lowStock, page = "1", limit = "50" } = req.query;
      const merchantId = req.merchant!.id;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const where: any = { merchantId, isActive: true };
      if (search) where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { sku:  { contains: search as string, mode: "insensitive" } },
      ];
      if (category) where.category = category;

      const [items, total] = await Promise.all([
        prisma.stockItem.findMany({ where, skip, take: parseInt(limit as string), orderBy: { name: "asc" } }),
        prisma.stockItem.count({ where }),
      ]);

      const lowStockItems = items.filter(i => Number(i.quantity) <= Number(i.minQuantity));

      res.json({ success: true, data: { items: lowStock ? lowStockItems : items, total, lowStockCount: lowStockItems.length } });
    } catch { res.status(500).json({ success: false, error: "Stok listesi alınamadı" }); }
  }),

  getById: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const item = await prisma.stockItem.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: { movements: { orderBy: { createdAt: "desc" }, take: 20 } },
      });
      if (!item) return res.status(404).json({ success: false, error: "Ürün bulunamadı" });
      res.json({ success: true, data: item });
    } catch { res.status(500).json({ success: false, error: "Ürün alınamadı" }); }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, sku, barcode, category, unit, quantity, minQuantity, costPrice, salePrice, vatRate, location, description } = req.body;
      if (!name) return res.status(400).json({ success: false, error: "Ürün adı zorunlu" });

      const item = await prisma.stockItem.create({
        data: { merchantId: req.merchant!.id, name, sku, barcode, category, unit: unit || "adet", quantity: quantity || 0, minQuantity: minQuantity || 0, costPrice, salePrice, vatRate: vatRate || 20, location, description },
      });

      if (quantity > 0) {
        await prisma.stockMovement.create({
          data: { stockItemId: item.id, merchantId: req.merchant!.id, type: "IN", quantity, unitPrice: costPrice, totalValue: costPrice ? costPrice * quantity : null, notes: "İlk stok girişi" },
        });
      }
      res.status(201).json({ success: true, data: item });
    } catch (e: any) {
      if (e.code === "P2002") return res.status(409).json({ success: false, error: "Bu SKU zaten kullanımda" });
      res.status(500).json({ success: false, error: "Ürün oluşturulamadı" });
    }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await prisma.stockItem.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!existing) return res.status(404).json({ success: false, error: "Ürün bulunamadı" });
      const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: req.body });
      res.json({ success: true, data: item });
    } catch { res.status(500).json({ success: false, error: "Güncelleme başarısız" }); }
  }),

  addMovement: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type, quantity, unitPrice, reference, notes } = req.body;
      if (!type || !quantity) return res.status(400).json({ success: false, error: "Tip ve miktar zorunlu" });

      const item = await prisma.stockItem.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!item) return res.status(404).json({ success: false, error: "Ürün bulunamadı" });

      const qtyChange = ["IN", "RETURN"].includes(type) ? quantity : -Math.abs(quantity);
      const newQty = Number(item.quantity) + qtyChange;
      if (newQty < 0) return res.status(400).json({ success: false, error: "Stok yetersiz" });

      const [movement, updated] = await prisma.$transaction([
        prisma.stockMovement.create({
          data: { stockItemId: item.id, merchantId: req.merchant!.id, type, quantity: Math.abs(quantity), unitPrice, totalValue: unitPrice ? unitPrice * Math.abs(quantity) : null, reference, notes },
        }),
        prisma.stockItem.update({ where: { id: item.id }, data: { quantity: newQty } }),
      ]);

      // Düşük stok uyarısı
      if (newQty <= Number(item.minQuantity) && Number(item.minQuantity) > 0) {
        await prisma.notification.create({
          data: { merchantId: req.merchant!.id, title: `⚠️ Düşük Stok: ${item.name}`, body: `${item.name} ürününde stok kritik seviyeye düştü. Mevcut: ${newQty} ${item.unit}`, type: "WARNING" },
        });
      }

      res.json({ success: true, data: { movement, currentQuantity: newQty } });
    } catch { res.status(500).json({ success: false, error: "Hareket eklenemedi" }); }
  }),

  summary: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const items = await prisma.stockItem.findMany({ where: { merchantId, isActive: true } });
      const totalValue = items.reduce((s, i) => s + Number(i.quantity) * Number(i.costPrice || 0), 0);
      const lowStockCount = items.filter(i => Number(i.quantity) <= Number(i.minQuantity)).length;
      const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
      res.json({ success: true, data: { totalItems: items.length, totalValue, lowStockCount, categories } });
    } catch { res.status(500).json({ success: false, error: "Özet alınamadı" }); }
  }),
};