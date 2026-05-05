// ============================================================
// Zyrix FinSuite - AI CFO Voice Assistant Service
// Track C - Sprint 2 Feature 1
//
// Multilingual AI financial advisor that answers questions
// about the merchant's cash flow, invoices, expenses, etc.
// Auto-detects the user's language (TR/EN/AR) and responds
// in the same language.
//
// Uses Gemini 1.5 Flash for both text and audio understanding
// (audio support is added in a follow-up; this initial version
// is text-in / text-out so the UI can wire it up immediately).
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";
import { prisma } from "../config/database";

// ----------------------------------------------------------------
// Build a structured context summary for a merchant
// ----------------------------------------------------------------

export type MerchantFinancialContext = {
  // Identification
  merchantId: string;
  businessName?: string;
  currency: string;

  // Cash position
  totalCashIn30Days: number;
  totalCashOut30Days: number;
  netCashFlow30Days: number;
  bankBalance: number;

  // Invoice health
  totalInvoicesOutstanding: number;
  overdueInvoicesCount: number;
  overdueInvoicesAmount: number;

  // Expenses
  totalExpenses30Days: number;
  topExpenseCategories: Array<{ category: string; amount: number }>;

  // Sales pipeline
  pipelineValue: number;
  wonDealsThisMonth: number;

  // Tax events
  upcomingTaxEvents: Array<{ type: string; dueDate: string; amount: number | null }>;
};

export async function buildFinancialContext(
  merchantId: string
): Promise<MerchantFinancialContext> {
  const now = new Date();
  const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Run all aggregations in parallel
  const [
    merchant,
    bankTxns30,
    bankConnections,
    invoicesOutstanding,
    invoicesOverdue,
    expenses30,
    topExpenseCats,
    deals,
    upcomingTax,
  ] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: merchantId } }),

    prisma.bankTransaction.findMany({
      where: { merchantId, transactionDate: { gte: days30Ago } },
    }),

    prisma.bankConnection.findMany({
      where: { merchantId, status: "CONNECTED" as any },
    }),

    prisma.invoice.aggregate({
      where: { merchantId, status: { in: ["DRAFT", "SENT", "OVERDUE"] as any } },
      _sum: { total: true },
      _count: true,
    }),

    prisma.invoice.aggregate({
      where: { merchantId, status: "OVERDUE" as any },
      _sum: { total: true },
      _count: true,
    }),

    prisma.expense.aggregate({
      where: { merchantId, date: { gte: days30Ago } },
      _sum: { amount: true },
    }),

    prisma.expense.groupBy({
      by: ["category"],
      where: { merchantId, date: { gte: days30Ago } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    }),

    prisma.deal.findMany({
      where: { merchantId, stage: { notIn: ["WON", "LOST"] as any } },
      select: { value: true, stage: true, createdAt: true },
    }),

    prisma.taxEvent.findMany({
      where: {
        merchantId,
        dueDate: {
          gte: now,
          lte: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
  ]);

  // Compute cash flow
  let totalIn = 0;
  let totalOut = 0;
  for (const t of bankTxns30) {
    const amt = Number(t.amount);
    if (String(t.direction) === "IN") totalIn += amt;
    else totalOut += amt;
  }

  // Latest balance from connected banks (use last sync)
  let bankBalance = 0;
  // Sum the latest balanceAfter per connection
  const balByConn = new Map<string, number>();
  for (const t of bankTxns30.sort(
    (a, b) => +new Date(b.transactionDate) - +new Date(a.transactionDate)
  )) {
    if (!balByConn.has(t.connectionId) && t.balanceAfter !== null) {
      balByConn.set(t.connectionId, Number(t.balanceAfter));
    }
  }
  bankBalance = Array.from(balByConn.values()).reduce((s, v) => s + v, 0);

  const pipelineValue = deals.reduce((s, d) => s + Number(d.value || 0), 0);
  const wonThisMonth = await prisma.deal.count({
    where: {
      merchantId,
      stage: "WON" as any,
      updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
    },
  });

  return {
    merchantId,
    businessName:
      (merchant as any)?.businessName || (merchant as any)?.name || undefined,
    currency: (merchant as any)?.currency || "TRY",
    totalCashIn30Days: Math.round(totalIn * 100) / 100,
    totalCashOut30Days: Math.round(totalOut * 100) / 100,
    netCashFlow30Days: Math.round((totalIn - totalOut) * 100) / 100,
    bankBalance: Math.round(bankBalance * 100) / 100,
    totalInvoicesOutstanding: Number(invoicesOutstanding._sum.total || 0),
    overdueInvoicesCount: invoicesOverdue._count || 0,
    overdueInvoicesAmount: Number(invoicesOverdue._sum.total || 0),
    totalExpenses30Days: Number(expenses30._sum.amount || 0),
    topExpenseCategories: topExpenseCats.map((c: any) => ({
      category: c.category,
      amount: Number(c._sum?.amount || 0),
    })),
    pipelineValue,
    wonDealsThisMonth: wonThisMonth,
    upcomingTaxEvents: upcomingTax.map((t: any) => ({
      type: String(t.eventType || t.type || "TAX"),
      dueDate: new Date(t.dueDate).toISOString().substring(0, 10),
      amount: t.amount !== null && t.amount !== undefined ? Number(t.amount) : null,
    })),
  };
}

// ----------------------------------------------------------------
// AI prompt builder
// ----------------------------------------------------------------

const SYSTEM_PROMPT = `You are Zyrix's AI CFO, a multilingual financial advisor for small business owners in Turkey, Saudi Arabia, the UAE and Iraq. You help them understand their cash flow, invoices, expenses and overall financial health.

CRITICAL LANGUAGE RULES:
- Detect the language the user wrote in (Turkish, English, or Arabic) and ALWAYS respond in that exact same language.
- If the user writes in Turkish, respond in clear, professional Turkish. Use Turkish accounting terms (KDV, mali müşavir, ciro, tahsilat).
- If the user writes in Arabic, respond in clear Modern Standard Arabic. Use Arabic accounting terms (الضريبة، التحصيل، السيولة).
- If the user writes in English, respond in concise English.
- Never mix languages within a single response.

STYLE:
- Be concise and actionable. Speak like a senior CFO advising a founder, not a chatbot.
- Always cite specific numbers from the financial context provided. Round to 2 decimals.
- When the situation is risky (negative cash flow, large overdue invoices, upcoming tax), flag it explicitly with a brief warning emoji.
- When asked for advice, give 1-3 concrete next steps.
- Never invent data. If the context does not contain something, say so.

You will receive the merchant's financial context as a JSON object. Use it as your only source of truth.`;

// ----------------------------------------------------------------
// Public entrypoint
// ----------------------------------------------------------------

export type AskResult = {
  success: boolean;
  reply?: string;
  detectedLanguage?: "tr" | "en" | "ar" | "unknown";
  contextUsed?: MerchantFinancialContext;
  error?: string;
};

export async function askCfo(
  merchantId: string,
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AskResult> {
  if (!env.geminiApiKey) {
    return { success: false, error: "GEMINI_API_KEY is not configured" };
  }
  if (!userMessage || userMessage.trim().length < 2) {
    return { success: false, error: "Empty question" };
  }

  // Build live financial context
  const ctx = await buildFinancialContext(merchantId);

  // Compose the conversation
  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  });

  // Convert history to Gemini format
  const geminiHistory = history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));

  // Inject the financial context as a system-level prelude on the first user turn
  const contextPrelude =
    "FINANCIAL CONTEXT (live data, JSON):\n" +
    JSON.stringify(ctx, null, 2) +
    "\n\nQuestion: " +
    userMessage.trim();

  try {
    const chat = model.startChat({
      history: geminiHistory,
    });
    const result = await chat.sendMessage(
      history.length === 0 ? contextPrelude : userMessage.trim()
    );
    const reply = result.response.text();

    // Lightweight language detection on the reply
    const detected: "tr" | "en" | "ar" | "unknown" = (() => {
      // Check for Arabic characters
      if (/[\u0600-\u06FF]/.test(reply)) return "ar";
      // Check for typical Turkish characters
      if (/[\u011F\u011E\u0130\u0131\u015E\u015F\u00C7\u00E7\u00DC\u00FC\u00D6\u00F6]/.test(reply)) return "tr";
      // Default English if Latin script
      if (/[a-zA-Z]/.test(reply)) return "en";
      return "unknown";
    })();

    return {
      success: true,
      reply,
      detectedLanguage: detected,
      contextUsed: ctx,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: "AI error: " + message };
  }
}
