// ============================================================
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
