// ================================================================
// Zyrix FinSuite — AI Müşteri Skor Controller
// Müşteri ödeme ve sadakat skorunu AI ile hesapla
// ================================================================

import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Skor Hesaplama Algoritması ───────────────────────────────
interface CustomerScoreInput {
  totalInvoices: number;
  paidOnTime: number;
  paidLate: number;
  unpaid: number;
  totalSpent: number;
  avgDaysToPay: number;
  dealCount: number;
  wonDeals: number;
  daysSinceLastActivity: number;
  taskCompletionRate: number;
}

interface CustomerScore {
  paymentScore: number;    // 0-100: ödeme zamanında yapma
  retentionScore: number;  // 0-100: müşteri kalma olasılığı
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  notes: string;
}

function calculateCustomerScore(input: CustomerScoreInput): CustomerScore {
  // ── Ödeme Skoru ──────────────────────────────────────────
  let paymentScore = 50; // Başlangıç

  if (input.totalInvoices > 0) {
    const paidRate = input.paidOnTime / input.totalInvoices;
    paymentScore = Math.round(paidRate * 100);

    // Geç ödeme cezası
    if (input.paidLate > 0) {
      paymentScore -= Math.min(20, input.paidLate * 5);
    }

    // Ödenmemiş fatura cezası
    if (input.unpaid > 0) {
      paymentScore -= Math.min(30, input.unpaid * 15);
    }

    // Ortalama ödeme süresi bonusu/cezası
    if (input.avgDaysToPay <= 7) paymentScore += 10;
    else if (input.avgDaysToPay > 30) paymentScore -= 15;
    else if (input.avgDaysToPay > 60) paymentScore -= 25;
  }

  paymentScore = Math.max(0, Math.min(100, paymentScore));

  // ── Retention Skoru ──────────────────────────────────────
  let retentionScore = 50;

  // Harcama hacmi bonusu
  if (input.totalSpent > 100000) retentionScore += 20;
  else if (input.totalSpent > 50000) retentionScore += 15;
  else if (input.totalSpent > 10000) retentionScore += 10;
  else if (input.totalSpent > 1000) retentionScore += 5;

  // Deal başarı oranı
  if (input.dealCount > 0) {
    const winRate = input.wonDeals / input.dealCount;
    retentionScore += Math.round(winRate * 15);
  }

  // Son aktivite — inaktiflik cezası
  if (input.daysSinceLastActivity > 180) retentionScore -= 25;
  else if (input.daysSinceLastActivity > 90) retentionScore -= 15;
  else if (input.daysSinceLastActivity > 30) retentionScore -= 5;
  else if (input.daysSinceLastActivity <= 7) retentionScore += 10;

  // Görev tamamlama oranı
  retentionScore += Math.round(input.taskCompletionRate * 10);

  retentionScore = Math.max(0, Math.min(100, retentionScore));

  // ── Risk Seviyesi ─────────────────────────────────────────
  const avgScore = (paymentScore + retentionScore) / 2;
  let riskLevel: "LOW" | "MEDIUM" | "HIGH";
  if (avgScore >= 70) riskLevel = "LOW";
  else if (avgScore >= 40) riskLevel = "MEDIUM";
  else riskLevel = "HIGH";

  // ── Açıklayıcı Not ────────────────────────────────────────
  let notes = "";
  const notesParts: string[] = [];

  if (paymentScore >= 80) notesParts.push("Düzenli ödeyen güvenilir müşteri");
  else if (paymentScore < 40) notesParts.push("Ödeme gecikmesi riski yüksek — takip önerilir");

  if (input.unpaid > 0) notesParts.push(`${input.unpaid} ödenmemiş fatura var`);
  if (input.avgDaysToPay > 45) notesParts.push(`Ortalama ödeme süresi ${input.avgDaysToPay} gün — normalin üzerinde`);
  if (input.daysSinceLastActivity > 60) notesParts.push(`${input.daysSinceLastActivity} gündür aktivite yok — yeniden bağlan`);
  if (retentionScore >= 75) notesParts.push("Müşteri kaybetme riski düşük");

  notes = notesParts.length > 0
    ? notesParts.join(". ") + "."
    : "Yeterli veri yok — daha fazla işlem sonrası skor hassaslaşır.";

  return { paymentScore, retentionScore, riskLevel, notes };
}

export const customerScoreController = {

  // ── POST /api/customer-score/:customerId — tek müşteri skoru hesapla
  scoreCustomer: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { customerId } = req.params;

      const customer = await prisma.customer.findFirst({
        where: { id: customerId, merchantId },
        include: {
          deals: true,
          tasks: true,
        },
      });

      if (!customer) {
        res.status(404).json({ success: false, error: "Müşteri bulunamadı" });
        return;
      }

      // Fatura istatistikleri
      const invoices = await prisma.invoice.findMany({
        where: {
          merchantId,
          customerName: customer.name, // customerName üzerinden eşleştirme
        },
        select: { status: true, dueDate: true, paidDate: true, total: true },
      });

      const totalInvoices = invoices.length;
      let paidOnTime = 0;
      let paidLate = 0;
      let unpaid = 0;
      let totalDaysSum = 0;
      let paidCount = 0;

      for (const inv of invoices) {
        if (inv.status === "PAID" && inv.paidDate) {
          const daysToPayment = Math.max(
            0,
            (new Date(inv.paidDate).getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysToPayment <= 0) paidOnTime++;
          else paidLate++;
          totalDaysSum += daysToPayment;
          paidCount++;
        } else if (inv.status === "OVERDUE") {
          unpaid++;
        } else if (inv.status === "SENT" && new Date(inv.dueDate) < new Date()) {
          unpaid++;
        }
      }

      const avgDaysToPay = paidCount > 0 ? Math.round(totalDaysSum / paidCount) : 0;

      // Son aktivite
      const lastDeal = customer.deals.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
      const daysSinceLastActivity = lastDeal
        ? Math.floor((Date.now() - new Date(lastDeal.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
        : Math.floor((Date.now() - new Date(customer.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      // Görev tamamlama oranı
      const doneTasks = customer.tasks.filter(t => t.status === "DONE").length;
      const taskCompletionRate = customer.tasks.length > 0 ? doneTasks / customer.tasks.length : 0;

      const wonDeals = customer.deals.filter(d => d.stage === "WON").length;

      const scoreInput: CustomerScoreInput = {
        totalInvoices,
        paidOnTime,
        paidLate,
        unpaid,
        totalSpent: Number(customer.totalSpent),
        avgDaysToPay,
        dealCount: customer.deals.length,
        wonDeals,
        daysSinceLastActivity,
        taskCompletionRate,
      };

      const score = calculateCustomerScore(scoreInput);

      // Skoru DB'ye kaydet
      const updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          aiPaymentScore: score.paymentScore,
          aiRetentionScore: score.retentionScore,
          aiRiskLevel: score.riskLevel,
          aiLastScored: new Date(),
          aiScoreNotes: score.notes,
          // healthScore'u da güncelle (eski alan — uyumluluk için)
          healthScore: Math.round((score.paymentScore + score.retentionScore) / 2),
        },
      });

      // YÜKSEK RİSK uyarısı — bildirim gönder
      if (score.riskLevel === "HIGH" && score.paymentScore < 30) {
        const existingNotif = await prisma.notification.findFirst({
          where: {
            merchantId,
            title: { contains: customer.name },
            createdAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // 7 günde bir
          },
        });
        if (!existingNotif) {
          await prisma.notification.create({
            data: {
              merchantId,
              title: `⚠️ Yüksek Risk: ${customer.name}`,
              body: `${customer.name} müşterinizin ödeme skoru ${score.paymentScore}/100. ${score.notes}`,
              type: "WARNING",
            },
          });
        }
      }

      res.status(200).json({
        success: true,
        data: {
          customerId,
          customerName: customer.name,
          scores: {
            paymentScore: score.paymentScore,
            retentionScore: score.retentionScore,
            overallScore: Math.round((score.paymentScore + score.retentionScore) / 2),
            riskLevel: score.riskLevel,
            notes: score.notes,
          },
          breakdown: {
            totalInvoices, paidOnTime, paidLate, unpaid,
            avgDaysToPay, wonDeals, daysSinceLastActivity,
          },
          scoredAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error("[Customer Score]", err);
      res.status(500).json({ success: false, error: "Skor hesaplanamadı" });
    }
  }),

  // ── POST /api/customer-score/batch — tüm müşterileri toplu skorla
  scoreAll: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;

      const customers = await prisma.customer.findMany({
        where: { merchantId },
        select: { id: true, name: true },
        take: 100, // max 100 müşteri
      });

      if (customers.length === 0) {
        res.status(200).json({ success: true, data: { scored: 0, message: "Henüz müşteri yok" } });
        return;
      }

      // Batch olarak skorla — her müşteri için ayrı hesaplama
      let scored = 0;
      let highRiskCount = 0;

      for (const customer of customers) {
        try {
          const invoices = await prisma.invoice.findMany({
            where: { merchantId, customerName: customer.name },
            select: { status: true, dueDate: true, paidDate: true, total: true },
          });

          const totalInvoices = invoices.length;
          let paidOnTime = 0, paidLate = 0, unpaid = 0, totalDaysSum = 0, paidCount = 0;

          for (const inv of invoices) {
            if (inv.status === "PAID" && inv.paidDate) {
              const days = (new Date(inv.paidDate).getTime() - new Date(inv.dueDate).getTime()) / 86400000;
              if (days <= 0) paidOnTime++; else paidLate++;
              totalDaysSum += Math.max(0, days);
              paidCount++;
            } else if (inv.status === "OVERDUE" || (inv.status === "SENT" && new Date(inv.dueDate) < new Date())) {
              unpaid++;
            }
          }

          const customerData = await prisma.customer.findUnique({
            where: { id: customer.id },
            include: { deals: { select: { stage: true, updatedAt: true } }, tasks: { select: { status: true } } },
          });

          if (!customerData) continue;

          const wonDeals = customerData.deals.filter(d => d.stage === "WON").length;
          const doneTasks = customerData.tasks.filter(t => t.status === "DONE").length;
          const taskCompletionRate = customerData.tasks.length > 0 ? doneTasks / customerData.tasks.length : 0;
          const avgDaysToPay = paidCount > 0 ? Math.round(totalDaysSum / paidCount) : 0;
          const daysSinceLastActivity = Math.floor((Date.now() - new Date(customerData.updatedAt).getTime()) / 86400000);

          const score = calculateCustomerScore({
            totalInvoices, paidOnTime, paidLate, unpaid,
            totalSpent: Number(customerData.totalSpent),
            avgDaysToPay, dealCount: customerData.deals.length,
            wonDeals, daysSinceLastActivity, taskCompletionRate,
          });

          await prisma.customer.update({
            where: { id: customer.id },
            data: {
              aiPaymentScore: score.paymentScore,
              aiRetentionScore: score.retentionScore,
              aiRiskLevel: score.riskLevel,
              aiLastScored: new Date(),
              aiScoreNotes: score.notes,
              healthScore: Math.round((score.paymentScore + score.retentionScore) / 2),
            },
          });

          scored++;
          if (score.riskLevel === "HIGH") highRiskCount++;
        } catch {
          // Tek müşteri hatasında devam et
        }
      }

      res.status(200).json({
        success: true,
        data: {
          scored,
          total: customers.length,
          highRiskCount,
          message: `${scored} müşteri skorlandı. ${highRiskCount} yüksek riskli müşteri tespit edildi.`,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Toplu skorlama başarısız" });
    }
  }),

  // ── GET /api/customer-score/summary — risk özeti
  summary: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;

      const [low, medium, high, unscored] = await Promise.all([
        prisma.customer.count({ where: { merchantId, aiRiskLevel: "LOW" } }),
        prisma.customer.count({ where: { merchantId, aiRiskLevel: "MEDIUM" } }),
        prisma.customer.count({ where: { merchantId, aiRiskLevel: "HIGH" } }),
        prisma.customer.count({ where: { merchantId, aiLastScored: null } }),
      ]);

      const highRiskCustomers = await prisma.customer.findMany({
        where: { merchantId, aiRiskLevel: "HIGH" },
        select: {
          id: true, name: true, email: true,
          aiPaymentScore: true, aiRetentionScore: true,
          aiScoreNotes: true, aiLastScored: true,
        },
        orderBy: { aiPaymentScore: "asc" },
        take: 5,
      });

      res.status(200).json({
        success: true,
        data: {
          distribution: { low, medium, high, unscored },
          highRiskCustomers,
          totalScored: low + medium + high,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Özet alınamadı" });
    }
  }),
};