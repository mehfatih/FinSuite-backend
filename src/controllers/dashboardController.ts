import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const dashboardController = {

  getStats: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      const [
        totalCustomers,
        newCustomersThisMonth,
        totalDeals,
        wonDealsThisMonth,
        totalInvoices,
        paidInvoicesThisMonth,
        pendingTasks,
        overdueInvoices,
        recentInvoices,
        recentDeals,
        recentTasks,
      ] = await Promise.all([
        prisma.customer.count({ where: { merchantId } }),
        prisma.customer.count({ where: { merchantId, createdAt: { gte: startOfMonth } } }),
        prisma.deal.count({ where: { merchantId } }),
        prisma.deal.count({ where: { merchantId, stage: "WON", wonAt: { gte: startOfMonth } } }),
        prisma.invoice.count({ where: { merchantId } }),
        prisma.invoice.count({ where: { merchantId, status: "PAID", paidDate: { gte: startOfMonth } } }),
        prisma.task.count({ where: { merchantId, status: { in: ["TODO", "IN_PROGRESS"] } } }),
        prisma.invoice.count({ where: { merchantId, status: "OVERDUE" } }),
        prisma.invoice.findMany({
          where: { merchantId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, invoiceNumber: true, customerName: true, total: true, status: true, createdAt: true }
        }),
        prisma.deal.findMany({
          where: { merchantId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, title: true, value: true, stage: true, probability: true, createdAt: true }
        }),
        prisma.task.findMany({
          where: { merchantId, status: { in: ["TODO", "IN_PROGRESS"] } },
          orderBy: { dueDate: "asc" },
          take: 5,
          select: { id: true, title: true, priority: true, status: true, dueDate: true }
        }),
      ]);

      const revenueThisMonth = await prisma.invoice.aggregate({
        where: { merchantId, status: "PAID", paidDate: { gte: startOfMonth } },
        _sum: { total: true }
      });

      const revenueLastMonth = await prisma.invoice.aggregate({
        where: { merchantId, status: "PAID", paidDate: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { total: true }
      });

      const pipelineValue = await prisma.deal.aggregate({
        where: { merchantId, stage: { notIn: ["WON", "LOST"] } },
        _sum: { value: true }
      });

      const thisMonthRevenue = Number(revenueThisMonth._sum.total || 0);
      const lastMonthRevenue = Number(revenueLastMonth._sum.total || 0);
      const revenueGrowth = lastMonthRevenue > 0
        ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
        : "0";

      res.status(200).json({
        success: true,
        data: {
          kpis: {
            totalCustomers,
            newCustomersThisMonth,
            totalDeals,
            wonDealsThisMonth,
            totalInvoices,
            paidInvoicesThisMonth,
            pendingTasks,
            overdueInvoices,
            revenueThisMonth: thisMonthRevenue,
            revenueLastMonth: lastMonthRevenue,
            revenueGrowth: parseFloat(revenueGrowth),
            pipelineValue: Number(pipelineValue._sum.value || 0),
          },
          recent: {
            invoices: recentInvoices,
            deals: recentDeals,
            tasks: recentTasks,
          }
        }
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).json({ success: false, error: "Failed to get dashboard stats" });
    }
  }),
};
