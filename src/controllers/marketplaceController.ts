// ================================================================
// Zyrix FinSuite — Pazar Yeri Entegrasyonu Controller (Feature 13)
// Trendyol / Hepsiburada sipariş senkronizasyonu
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Trendyol Real API ─────────────────────────────────────────
async function fetchTrendyolOrders(supplierId: string, apiKey: string, apiSecret: string): Promise<any[]> {
  if (!supplierId || !apiKey || !apiSecret) {
    // Sandbox — demo siparişler döndür
    return [
      {
        id: `TY-DEMO-${Date.now()}`,
        orderNumber: `TY2026${Math.floor(Math.random() * 100000)}`,
        customerFirstName: "Demo",
        customerLastName: "Müşteri",
        grossAmount: 299.90,
        totalDiscount: 0,
        lines: [
          { productName: "Demo Ürün A", barcode: "BAR001", quantity: 2, price: 149.95, amount: 299.90 },
        ],
        orderDate: Date.now(),
        status: "Created",
        shipmentPackages: [],
      },
    ];
  }

  try {
    // Trendyol Partner API v2
    const credentials = Buffer.from(`${supplierId}:${apiKey}:${apiSecret}`).toString("base64");

    // Son 7 günün siparişleri
    const endDate   = Date.now();
    const startDate = endDate - 7 * 24 * 60 * 60 * 1000;

    const params = new URLSearchParams({
      startDate: String(startDate),
      endDate:   String(endDate),
      page:      "0",
      size:      "50",
      status:    "Created",
    });

    const response = await fetch(
      `https://api.trendyol.com/sapigw/suppliers/${supplierId}/orders?${params}`,
      {
        headers: {
          "Authorization": `Basic ${credentials}`,
          "User-Agent":    `${supplierId} - ZyrixFinSuite/3.0`,
          "Content-Type":  "application/json",
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Trendyol] API ${response.status}:`, errText);
      return [];
    }

    const data = await response.json();
    return data?.content || [];
  } catch (err) {
    console.error("[Trendyol] Fetch error:", err);
    return [];
  }
}

// ── Hepsiburada Real API ──────────────────────────────────────
async function fetchHepsiburadaOrders(apiKey: string, apiSecret?: string): Promise<any[]> {
  if (!apiKey || !apiSecret) {
    // Sandbox — demo siparişler döndür
    return [
      {
        id: `HB-DEMO-${Date.now()}`,
        orderNumber: `HB2026${Math.floor(Math.random() * 100000)}`,
        customerName: "Demo HB Müşteri",
        totalPrice: 459.00,
        lines: [{ name: "Demo Ürün B", quantity: 1, price: 459.00 }],
        orderDate: new Date().toISOString(),
        status: "New",
      },
    ];
  }

  try {
    const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    const response = await fetch(
      "https://listing-external.hepsiburada.com/listings/merchantlisting/allorders",
      {
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type":  "application/json",
          "Accept":        "application/json",
        },
      }
    );

    if (!response.ok) return [];
    const data = await response.json();
    return data?.items || data?.orders || [];
  } catch (err) {
    console.error("[Hepsiburada] Fetch error:", err);
    return [];
  }
}

export const marketplaceController = {

  // ── GET /api/marketplace/orders
  listOrders: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channel, status, page = "1", limit = "30" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const where: any = { merchantId: req.merchant!.id };
      if (channel) where.channel = channel;
      if (status) where.status = status;

      const [orders, total] = await Promise.all([
        prisma.marketplaceOrder.findMany({ where, skip, take: parseInt(limit as string), orderBy: { orderDate: "desc" } }),
        prisma.marketplaceOrder.count({ where }),
      ]);

      const stats = await prisma.marketplaceOrder.groupBy({
        by: ["channel"],
        where: { merchantId: req.merchant!.id },
        _count: true,
        _sum: { total: true },
      });

      res.json({ success: true, data: { orders, total, stats } });
    } catch { res.status(500).json({ success: false, error: "Siparişler alınamadı" }); }
  }),

  // ── POST /api/marketplace/sync/:channel — senkronize et
  sync: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channel } = req.params;
      const merchantId = req.merchant!.id;

      const integration = await prisma.marketplaceIntegration.findUnique({
        where: { merchantId_channel: { merchantId, channel: channel as any } },
      });

      let rawOrders: any[] = [];
      if (channel === "TRENDYOL") {
        rawOrders = await fetchTrendyolOrders(
          integration?.supplierId || "",
          integration?.apiKey    || "",
          integration?.apiSecret || ""
        );
      } else if (channel === "HEPSIBURADA") {
        rawOrders = await fetchHepsiburadaOrders(
          integration?.apiKey    || "",
          integration?.apiSecret || ""
        );
      }

      let created = 0, updated = 0;
      for (const o of rawOrders) {
        const externalId    = String(o.id || o.orderNumber);
        const total         = o.grossAmount || o.totalPrice || 0;
        const customerName  = o.customerFirstName
          ? `${o.customerFirstName} ${o.customerLastName}`
          : o.customerName || "Bilinmiyor";
        const items         = o.lines?.map((l: any) => ({
          name: l.productName || l.name,
          quantity: l.quantity,
          price: l.price,
        })) || [];
        const commission    = total * 0.15;

        const existing = await prisma.marketplaceOrder.findUnique({
          where: { merchantId_channel_externalOrderId: { merchantId, channel: channel as any, externalOrderId: externalId } },
        });

        if (existing) {
          await prisma.marketplaceOrder.update({
            where: { id: existing.id },
            data:  { status: o.status, syncedAt: new Date() },
          });
          updated++;
        } else {
          await prisma.marketplaceOrder.create({
            data: {
              merchantId, channel: channel as any,
              externalOrderId: externalId,
              customerName, items,
              subtotal:     total - commission,
              commission,
              shippingCost: 0,
              total,
              status:    o.status || "NEW",
              orderDate: new Date(o.orderDate),
            },
          });
          created++;
        }
      }

      if (integration) {
        await prisma.marketplaceIntegration.update({
          where: { id: integration.id },
          data:  { lastSyncAt: new Date() },
        });
      }

      res.json({
        success: true,
        data:    { created, updated, total: rawOrders.length },
        message: `${channel}: ${created} yeni, ${updated} güncellendi`,
      });
    } catch { res.status(500).json({ success: false, error: "Senkronizasyon başarısız" }); }
  }),

  // ── POST /api/marketplace/integrations — entegrasyon kaydet
  saveIntegration: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channel, apiKey, apiSecret, supplierId } = req.body;
      if (!channel) return res.status(400).json({ success: false, error: "Kanal zorunlu" });

      const integration = await prisma.marketplaceIntegration.upsert({
        where:  { merchantId_channel: { merchantId: req.merchant!.id, channel } },
        create: { merchantId: req.merchant!.id, channel, apiKey, apiSecret, supplierId },
        update: { apiKey, apiSecret, supplierId, isActive: true },
      });
      res.json({ success: true, data: integration });
    } catch { res.status(500).json({ success: false, error: "Entegrasyon kaydedilemedi" }); }
  }),

  // ── GET /api/marketplace/integrations
  listIntegrations: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const integrations = await prisma.marketplaceIntegration.findMany({
        where: { merchantId: req.merchant!.id },
      });
      const safe = integrations.map(i => ({
        ...i,
        apiKey:    i.apiKey    ? `${i.apiKey.slice(0, 4)}...`    : null,
        apiSecret: i.apiSecret ? "***" : null,
      }));
      res.json({ success: true, data: safe });
    } catch { res.status(500).json({ success: false, error: "Entegrasyonlar alınamadı" }); }
  }),

  // ── POST /api/marketplace/orders/:id/create-invoice — sipariş → fatura
  createInvoice: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const order = await prisma.marketplaceOrder.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
      });
      if (!order) return res.status(404).json({ success: false, error: "Sipariş bulunamadı" });
      if (order.invoiceId) return res.status(409).json({ success: false, error: "Bu sipariş için zaten fatura var" });

      const count         = await prisma.invoice.count({ where: { merchantId: req.merchant!.id } });
      const invoiceNumber = `MKT-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
      const vatAmount     = Number(order.subtotal) * 0.20;

      const invoice = await prisma.invoice.create({
        data: {
          merchantId:   req.merchant!.id,
          invoiceNumber,
          customerName: order.customerName,
          items:        order.items,
          subtotal:     order.subtotal,
          vatRate:      20,
          vatAmount,
          total:        Number(order.subtotal) + vatAmount,
          currency:     order.currency,
          status:       "SENT",
          dueDate:      new Date(Date.now() + 30 * 86400000),
          notes:        `${order.channel} Sipariş: ${order.externalOrderId}`,
        },
      });

      await prisma.marketplaceOrder.update({
        where: { id: order.id },
        data:  { invoiceId: invoice.id },
      });

      res.json({ success: true, data: invoice });
    } catch { res.status(500).json({ success: false, error: "Fatura oluşturulamadı" }); }
  }),
};
