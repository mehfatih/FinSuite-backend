// ================================================================
// Zyrix FinSuite — Benchmark & Sektör Karşılaştırması (Feature 15)
// Merchant verisini anonim sektör ortalamasıyla karşılaştır
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Snapshot Hesapla ─────────────────────────────────────────
async function computeSnapshot(merchantId: string, period: string) {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0, 23, 59, 59);

  const [invoices, customers] = await Promise.all([
    prisma.invoice.findMany({ where: { merchantId, createdAt: { gte: start, lte: end } } }),
    prisma.customer.findMany({ where: { merchantId, createdAt: { lte: end } } }),
  ]);

  const paidInvoices = invoices.filter(i => i.status === "PAID");
  const monthlyRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
  const invoiceCount = invoices.length;
  const avgInvoiceValue = invoiceCount > 0 ? monthlyRevenue / invoiceCount : 0;
  const collectionRate = invoiceCount > 0 ? (paidInvoices.length / invoiceCount) * 100 : 0;

  let totalDays = 0;
  let paidCount = 0;
  for (const inv of paidInvoices) {
    if (inv.paidDate) {
      totalDays += Math.max(0, (new Date(inv.paidDate).getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      paidCount++;
    }
  }
  const avgDaysToPay = paidCount > 0 ? Math.round(totalDays / paidCount) : 0;
  const activeCustomers = customers.length;

  return { monthlyRevenue, invoiceCount, avgInvoiceValue, collectionRate, avgDaysToPay, activeCustomers };
}

export const benchmarkController = {

  // ── POST /api/benchmark/snapshot — bu ay snapshot kaydet
  snapshot: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const period = req.body.period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { businessType: true, country: true } });
      const data = await computeSnapshot(merchantId, period);

      const snapshot = await prisma.benchmarkSnapshot.upsert({
        where: { merchantId_period: { merchantId, period } },
        create: { merchantId, period, sector: merchant?.businessType, province: merchant?.country, ...data },
        update: { ...data },
      });

      res.json({ success: true, data: snapshot });
    } catch { res.status(500).json({ success: false, error: "Snapshot oluşturulamadı" }); }
  }),

  // ── GET /api/benchmark/compare — kendi verisini ortalama ile karşılaştır
  compare: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const period = (req.query.period as string) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { businessType: true, country: true, businessName: true } });
      let snapshot = await prisma.benchmarkSnapshot.findUnique({ where: { merchantId_period: { merchantId, period } } });
      if (!snapshot) {
        const data = await computeSnapshot(merchantId, period);
        snapshot = await prisma.benchmarkSnapshot.create({ data: { merchantId, period, sector: merchant?.businessType, province: merchant?.country, ...data } });
      }

      // Sektör ortalaması — önce spesifik sektör+il, yoksa sadece sektör, yoksa genel
      const avg = await prisma.benchmarkAverage.findFirst({
        where: { period, sector: merchant?.businessType || undefined, province: merchant?.country || undefined },
      }) || await prisma.benchmarkAverage.findFirst({ where: { period, sector: merchant?.businessType || undefined } })
        || await prisma.benchmarkAverage.findFirst({ where: { period } });

      const comparison = avg ? {
        revenue:        { yours: Number(snapshot.monthlyRevenue), average: Number(avg.avgRevenue),         diff: Number(snapshot.monthlyRevenue) - Number(avg.avgRevenue),         diffPct: avg.avgRevenue > 0 ? ((Number(snapshot.monthlyRevenue) - Number(avg.avgRevenue)) / Number(avg.avgRevenue)) * 100 : 0 },
        invoiceValue:   { yours: Number(snapshot.avgInvoiceValue), average: Number(avg.avgInvoiceValue),   diff: Number(snapshot.avgInvoiceValue) - Number(avg.avgInvoiceValue),   diffPct: avg.avgInvoiceValue > 0 ? ((Number(snapshot.avgInvoiceValue) - Number(avg.avgInvoiceValue)) / Number(avg.avgInvoiceValue)) * 100 : 0 },
        collectionRate: { yours: Number(snapshot.collectionRate),  average: Number(avg.avgCollectionRate), diff: Number(snapshot.collectionRate) - Number(avg.avgCollectionRate),  diffPct: 0 },
        daysToPay:      { yours: snapshot.avgDaysToPay,            average: avg.avgDaysToPay,              diff: snapshot.avgDaysToPay - avg.avgDaysToPay,                          note: snapshot.avgDaysToPay > avg.avgDaysToPay ? "Ortalamadan daha uzun sürüyor" : "Ortalamanın altında — iyi!" },
      } : null;

      // Insights üret
      const insights: string[] = [];
      if (comparison) {
        if (comparison.revenue.diffPct > 20) insights.push(`Geliriniz sektör ortalamasının %${comparison.revenue.diffPct.toFixed(0)} üzerinde — harika performans!`);
        else if (comparison.revenue.diffPct < -20) insights.push(`Geliriniz sektör ortalamasının %${Math.abs(comparison.revenue.diffPct).toFixed(0)} altında. Müşteri kazanımını artırabilirsiniz.`);
        if (comparison.collectionRate.diff < -10) insights.push(`Tahsilat oranınız (%${comparison.collectionRate.yours.toFixed(0)}) sektör ortalamasının (%${comparison.collectionRate.average.toFixed(0)}) altında.`);
        if (comparison.daysToPay.diff > 15) insights.push(`Ortalama ödeme süreniz sektörden ${comparison.daysToPay.diff} gün uzun — WhatsApp hatırlatma özelliğini kullanın.`);
      } else {
        insights.push("Henüz bu sektör için karşılaştırma verisi yok. Daha fazla merchant data ürettikçe karşılaştırma aktifleşir.");
      }

      res.json({ success: true, data: { snapshot, average: avg, comparison, insights, period, sector: merchant?.businessType || "Genel" } });
    } catch { res.status(500).json({ success: false, error: "Karşılaştırma yapılamadı" }); }
  }),

  // ── GET /api/benchmark/history — kendi geçmiş snapshot'ları
  history: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const snapshots = await prisma.benchmarkSnapshot.findMany({
        where: { merchantId: req.merchant!.id },
        orderBy: { period: "desc" },
        take: 12,
      });
      res.json({ success: true, data: snapshots });
    } catch { res.status(500).json({ success: false, error: "Geçmiş alınamadı" }); }
  }),
};