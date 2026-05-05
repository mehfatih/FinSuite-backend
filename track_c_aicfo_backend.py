# ============================================================
# Track C - Sprint 2 Feature 1: AI CFO Voice Assistant
# Backend: service + controller + route + wire
# ============================================================
from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("AI CFO Voice Assistant - Backend batch")
print("=" * 70)

# ============================================================
# 1) Create src/services/aiCfoVoiceService.ts
# ============================================================
SVC = ROOT / "src" / "services" / "aiCfoVoiceService.ts"
print()
print("[1/4] Create aiCfoVoiceService.ts")

svc_content = '''// ============================================================
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
    "FINANCIAL CONTEXT (live data, JSON):\\n" +
    JSON.stringify(ctx, null, 2) +
    "\\n\\nQuestion: " +
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
      if (/[\\u0600-\\u06FF]/.test(reply)) return "ar";
      // Check for typical Turkish characters
      if (/[\\u011F\\u011E\\u0130\\u0131\\u015E\\u015F\\u00C7\\u00E7\\u00DC\\u00FC\\u00D6\\u00F6]/.test(reply)) return "tr";
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
'''

SVC.write_text(svc_content, encoding="utf-8")
print("    [OK] Service created (size: " + str(SVC.stat().st_size) + " bytes)")

# ============================================================
# 2) Create src/controllers/aiCfoVoiceController.ts
# ============================================================
CTRL = ROOT / "src" / "controllers" / "aiCfoVoiceController.ts"
print()
print("[2/4] Create aiCfoVoiceController.ts")

ctrl_content = '''// ============================================================
// Zyrix FinSuite - AI CFO Voice Controller
// Track C - Sprint 2 Feature 1
//
// Endpoints (all authenticated):
//   POST /api/ai-cfo/ask           ask a question (text)
//   GET  /api/ai-cfo/conversations list past conversations
//   GET  /api/ai-cfo/conversations/:id  get one conversation thread
//   GET  /api/ai-cfo/context       get the live financial context (no AI call)
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { askCfo, buildFinancialContext } from "../services/aiCfoVoiceService";
import { pid } from "../utils/params";

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
  };
}

const askSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  conversationId: z.string().uuid().optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /ask
// ----------------------------------------------------------------

export async function askHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { question, conversationId } = parsed.data;

  // Load history if continuing a conversation
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let convo: any = null;

  if (conversationId) {
    convo = await prisma.aiConversation.findFirst({
      where: { id: conversationId, merchantId: req.merchant.id },
    });
    if (convo && Array.isArray(convo.messages)) {
      history = convo.messages as any;
    }
  }

  // Call the AI
  const result = await askCfo(req.merchant.id, question, history);

  if (!result.success || !result.reply) {
    return fail(res, 502, result.error || "AI request failed");
  }

  // Append to history
  const newHistory = [
    ...history,
    { role: "user" as const, content: question },
    { role: "assistant" as const, content: result.reply },
  ];

  // Persist (upsert)
  let saved: any;
  if (convo) {
    saved = await prisma.aiConversation.update({
      where: { id: convo.id },
      data: {
        messages: newHistory as any,
        context: { type: "cfo" } as any,
      } as any,
    });
  } else {
    // Make a short title from the first question
    const title = question.slice(0, 60).trim();
    saved = await prisma.aiConversation.create({
      data: {
        merchantId: req.merchant.id,
        title,
        messages: newHistory as any,
        context: { type: "cfo" } as any,
      } as any,
    });
  }

  return ok(res, {
    conversationId: saved.id,
    reply: result.reply,
    detectedLanguage: result.detectedLanguage,
    messages: newHistory,
  });
}

// ----------------------------------------------------------------
// GET /conversations
// ----------------------------------------------------------------

export async function listHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.aiConversation.findMany({
    where: {
      merchantId: req.merchant.id,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
      context: true,
    },
  });

  // Filter only CFO conversations (context.type === "cfo")
  const cfoRows = rows.filter((r: any) => {
    const ctx = r.context as any;
    return !ctx || ctx?.type === "cfo";
  });

  return ok(res, cfoRows);
}

// ----------------------------------------------------------------
// GET /conversations/:id
// ----------------------------------------------------------------

export async function getHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const row = await prisma.aiConversation.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!row) return fail(res, 404, "Not found");

  return ok(res, row);
}

// ----------------------------------------------------------------
// GET /context
// ----------------------------------------------------------------

export async function contextHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  try {
    const ctx = await buildFinancialContext(req.merchant.id);
    return ok(res, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return fail(res, 500, "Failed to build context: " + msg);
  }
}
'''

CTRL.write_text(ctrl_content, encoding="utf-8")
print("    [OK] Controller created (size: " + str(CTRL.stat().st_size) + " bytes)")

# ============================================================
# 3) Create src/routes/aiCfoVoice.ts
# ============================================================
RT = ROOT / "src" / "routes" / "aiCfoVoice.ts"
print()
print("[3/4] Create aiCfoVoice.ts route")

rt_content = '''// ============================================================
// Zyrix FinSuite - AI CFO Voice Routes
// Track C - Sprint 2 Feature 1
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  askHandler,
  listHandler,
  getHandler,
  contextHandler,
} from "../controllers/aiCfoVoiceController";

const router = Router();

router.use(authenticate as any);

const askRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many AI questions this hour. Please slow down.",
  },
});

router.post("/ask", askRateLimiter, askHandler as any);
router.get("/conversations", listHandler as any);
router.get("/conversations/:id", getHandler as any);
router.get("/context", contextHandler as any);

export default router;
'''

RT.write_text(rt_content, encoding="utf-8")
print("    [OK] Route created")

# ============================================================
# 4) Wire into src/index.ts
# ============================================================
INDEX = ROOT / "src" / "index.ts"
shutil.copy2(INDEX, INDEX.with_suffix(".ts.backup-track-c"))
print()
print("[4/4] Wire into src/index.ts")

idx = INDEX.read_text(encoding="utf-8")
new_imp = 'import aiCfoVoiceRoutes from "./routes/aiCfoVoice";'
new_use = 'app.use("/api/ai-cfo", aiCfoVoiceRoutes);'

if 'aiCfoVoiceRoutes' not in idx:
    # Add import after banksRoutes import
    idx = idx.replace(
        'import banksRoutes         from "./routes/banks";',
        'import banksRoutes         from "./routes/banks";\n' + new_imp,
        1,
    )
    print("    [OK] Import added")

if '"/api/ai-cfo"' not in idx:
    idx = idx.replace(
        'app.use("/api/banks",          banksRoutes);',
        'app.use("/api/banks",          banksRoutes);\n' + new_use,
        1,
    )
    print("    [OK] Route registered")

# Bump version
idx = idx.replace("Zyrix FinSuite v3.4", "Zyrix FinSuite v3.5", 1)
idx = idx.replace("20 features | 33 routes", "21 features | 37 routes", 1)
INDEX.write_text(idx, encoding="utf-8")
print("    [OK] Version bumped to v3.5")

# ============================================================
# Verification
# ============================================================
print()
print("=" * 70)
print("VERIFICATION")
print("=" * 70)
final_idx = INDEX.read_text(encoding="utf-8")
checks = [
    ("Service file exists",        SVC.exists()),
    ("Controller file exists",     CTRL.exists()),
    ("Route file exists",          RT.exists()),
    ("Import in index.ts",         'aiCfoVoiceRoutes' in final_idx),
    ("/api/ai-cfo registered",     '"/api/ai-cfo"' in final_idx),
    ("v3.5",                       'v3.5' in final_idx),
    ("21 features | 37 routes",    "21 features | 37 routes" in final_idx),
]
passed = 0
for label, ok_check in checks:
    s = "OK" if ok_check else "MISSING"
    if ok_check: passed += 1
    print("     " + label.ljust(35) + " -> " + s)
print()
print("RESULT: " + str(passed) + "/" + str(len(checks)) + " checks passed")
print("=" * 70)
