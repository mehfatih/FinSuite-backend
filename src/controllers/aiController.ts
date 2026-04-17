import { Response, RequestHandler } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";
import { env } from "../config/env";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const getGenAI = () => new GoogleGenerativeAI(env.geminiApiKey);

export const aiController = {

  chat: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { message, conversationId } = req.body;

      if (!message) { res.status(400).json({ success: false, error: "Message is required" }); return; }

      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { name: true, businessName: true, currency: true, country: true, language: true }
      });

      const revenueData = await prisma.invoice.aggregate({
        where: { merchantId, status: "PAID" },
        _sum: { total: true },
        _count: { id: true }
      });

      const pendingInvoices = await prisma.invoice.aggregate({
        where: { merchantId, status: { in: ["SENT", "OVERDUE"] } },
        _sum: { total: true },
        _count: { id: true }
      });

      const totalCustomers = await prisma.customer.count({ where: { merchantId } });
      const activeDeals = await prisma.deal.count({ where: { merchantId, stage: { notIn: ["WON", "LOST"] } } });
      const pendingTasks = await prisma.task.count({ where: { merchantId, status: { in: ["TODO", "IN_PROGRESS"] } } });

      const systemPrompt = `You are the AI CFO assistant for ${merchant?.businessName || merchant?.name}.
Business Context:
- Country: ${merchant?.country} | Currency: ${merchant?.currency} | Language: ${merchant?.language}
- Total Revenue Collected: ${revenueData._sum.total || 0} ${merchant?.currency}
- Total Paid Invoices: ${revenueData._count.id}
- Pending Invoices Value: ${pendingInvoices._sum.total || 0} ${merchant?.currency} (${pendingInvoices._count.id} invoices)
- Total Customers: ${totalCustomers}
- Active Deals in Pipeline: ${activeDeals}
- Pending Tasks: ${pendingTasks}

You are a professional financial advisor. Provide specific, actionable insights based on this data.
Respond in the same language the user writes in (Arabic, Turkish, or English).
Be concise, professional, and data-driven.`;

      let conversation;
      let messages: any[] = [];

      if (conversationId) {
        conversation = await prisma.aiConversation.findFirst({
          where: { id: conversationId, merchantId }
        });
        if (conversation) messages = conversation.messages as any[];
      }

      messages.push({ role: "user", content: message, timestamp: new Date().toISOString() });

      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const chat = model.startChat({
        systemInstruction: systemPrompt,
        history: messages.slice(0, -1).map((m: any) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        })),
      });

      const result = await chat.sendMessage(message);
      const aiResponse = result.response.text();

      messages.push({ role: "assistant", content: aiResponse, timestamp: new Date().toISOString() });

      if (conversationId && conversation) {
        await prisma.aiConversation.update({
          where: { id: conversationId },
          data: { messages, tokens: { increment: message.length + aiResponse.length } }
        });
      } else {
        conversation = await prisma.aiConversation.create({
          data: {
            merchantId,
            title: message.substring(0, 50),
            messages,
            tokens: message.length + aiResponse.length,
          }
        });
      }

      res.status(200).json({
        success: true,
        data: {
          response: aiResponse,
          conversationId: conversation.id,
        }
      });
    } catch (err) {
      console.error("AI Chat error:", err);
      res.status(500).json({ success: false, error: "AI service unavailable" });
    }
  }),

  getConversations: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const conversations = await prisma.aiConversation.findMany({
        where: { merchantId },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, title: true, createdAt: true, updatedAt: true, tokens: true }
      });
      res.status(200).json({ success: true, data: conversations });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get conversations" });
    }
  }),

  getConversation: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const conversation = await prisma.aiConversation.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!conversation) { res.status(404).json({ success: false, error: "Conversation not found" }); return; }
      res.status(200).json({ success: true, data: conversation });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get conversation" });
    }
  }),

  cashFlowForecast: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { businessName: true, currency: true, country: true }
      });

      const last90Days = new Date();
      last90Days.setDate(last90Days.getDate() - 90);

      const [paidInvoices, pendingInvoices, expenses] = await Promise.all([
        prisma.invoice.findMany({
          where: { merchantId, status: "PAID", paidDate: { gte: last90Days } },
          select: { total: true, paidDate: true }
        }),
        prisma.invoice.findMany({
          where: { merchantId, status: { in: ["SENT", "OVERDUE"] } },
          select: { total: true, dueDate: true }
        }),
        prisma.expense.findMany({
          where: { merchantId, date: { gte: last90Days } },
          select: { amount: true, date: true, category: true }
        }),
      ]);

      const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total), 0);
      const avgMonthlyRevenue = totalRevenue / 3;
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
      const avgMonthlyExpenses = totalExpenses / 3;
      const pendingAmount = pendingInvoices.reduce((s, i) => s + Number(i.total), 0);

      const prompt = `As CFO AI for ${merchant?.businessName}, analyze this 90-day financial data:
- Average Monthly Revenue: ${avgMonthlyRevenue.toFixed(2)} ${merchant?.currency}
- Average Monthly Expenses: ${avgMonthlyExpenses.toFixed(2)} ${merchant?.currency}
- Pending Invoices: ${pendingAmount.toFixed(2)} ${merchant?.currency}
- Net Monthly Cash Flow: ${(avgMonthlyRevenue - avgMonthlyExpenses).toFixed(2)} ${merchant?.currency}

Provide a 3-month cash flow forecast with:
1. Projected revenue for each month
2. Expected expenses
3. Net cash flow
4. Key risks and opportunities
5. One specific action to improve cash flow

Be specific with numbers. Respond in English.`;

      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent(prompt);
      const forecast = result.response.text();

      res.status(200).json({
        success: true,
        data: {
          summary: {
            avgMonthlyRevenue,
            avgMonthlyExpenses,
            netCashFlow: avgMonthlyRevenue - avgMonthlyExpenses,
            pendingAmount,
          },
          forecast,
        }
      });
    } catch (err) {
      console.error("Cash flow forecast error:", err);
      res.status(500).json({ success: false, error: "Failed to generate forecast" });
    }
  }),
};
