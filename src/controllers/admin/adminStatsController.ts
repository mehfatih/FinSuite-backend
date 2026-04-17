import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const adminStatsController = {

  getStats: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      const [
        totalMerchants,
        activeMerchants,
        trialMerchants,
        suspendedMerchants,
        newMerchantsThisMonth,
        totalInvoices,
        totalCustomers,
        totalDeals,
      ] = await Promise.all([
        prisma.merchant.count(),
        prisma.merchant.count({ where: { status: "ACTIVE" } }),
        prisma.merchant.count({ where: { status: "TRIAL" } }),
        prisma.merchant.count({ where: { status: "SUSPENDED" } }),
        prisma.merchant.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.invoice.count(),
        prisma.customer.count(),
        prisma.deal.count(),
      ]);

      const revenueThisMonth = await prisma.invoice.aggregate({
        where: { status: "PAID", paidDate: { gte: startOfMonth } },
        _sum: { total: true }
      });

      const revenueLastMonth = await prisma.invoice.aggregate({
        where: { status: "PAID", paidDate: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { total: true }
      });

      const planDistribution = await prisma.merchant.groupBy({
        by: ["plan"],
        _count: { id: true }
      });

      const countryDistribution = await prisma.merchant.groupBy({
        by: ["country"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10
      });

      res.status(200).json({
        success: true,
        data: {
          merchants: {
            total: totalMerchants,
            active: activeMerchants,
            trial: trialMerchants,
            suspended: suspendedMerchants,
            newThisMonth: newMerchantsThisMonth,
          },
          revenue: {
            thisMonth: Number(revenueThisMonth._sum.total || 0),
            lastMonth: Number(revenueLastMonth._sum.total || 0),
          },
          totals: { invoices: totalInvoices, customers: totalCustomers, deals: totalDeals },
          planDistribution,
          countryDistribution,
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get stats" });
    }
  }),
};
