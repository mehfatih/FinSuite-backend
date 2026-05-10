// ================================================================
// Sprint D-8 — Customer-side chat conversation CRUD.
//
//   GET    /api/customer/chat/conversations                  list
//   POST   /api/customer/chat/conversations                  create empty
//   GET    /api/customer/chat/conversations/:id              get one
//   PATCH  /api/customer/chat/conversations/:id              rename / pin / archive / retentionDays
//   DELETE /api/customer/chat/conversations/:id              hard delete (cascade messages)
//   GET    /api/customer/chat/conversations/:id/messages     paginated message list
//
// All authenticated; merchantId from req.merchant.id. Every query
// filters by merchantId — multi-tenant isolation per spec hard rule.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const MAX_TITLE_LEN = 120;

function payloadOf(row: any) {
  return {
    id:             row.id,
    title:          row.title,
    pinned:         row.pinned,
    archived:       row.archived,
    retentionDays:  row.retentionDays,
    expiresAt:      row.expiresAt,
    lastMessageAt:  row.lastMessageAt,
    createdAt:      row.createdAt
  };
}

function messagePayload(row: any) {
  return {
    id:           row.id,
    role:         row.role,
    content:      row.content,
    toolCalls:    row.toolCalls,
    toolResults:  row.toolResults,
    citations:    row.citations,
    charts:       row.charts,
    actions:      row.actions,
    tokensUsed:   row.tokensUsed,
    inputTokens:  row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs:    row.latencyMs,
    createdAt:    row.createdAt
  };
}

export const chatConversationsController = {

  // GET / — list conversations
  list: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const limit  = Math.max(1, Math.min(50, parseInt(String(req.query.limit  ?? "30"), 10) || 30));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const includeArchived = String(req.query.archived ?? "") === "true";

      const where: any = { merchantId };
      if (!includeArchived) where.archived = false;

      const [rows, total] = await Promise.all([
        prisma.chatConversation.findMany({
          where,
          orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
          take:    limit,
          skip:    offset
        }),
        prisma.chatConversation.count({ where })
      ]);
      res.json({
        success: true,
        data: {
          conversations: rows.map(payloadOf),
          total, limit, offset
        }
      });
    } catch (err: any) {
      console.error("[chat/conversations.list] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load conversations" });
    }
  }),

  // POST / — create empty conversation
  create: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const body = req.body || {};
    const title = typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, MAX_TITLE_LEN)
      : undefined;
    const retentionDays = typeof body.retentionDays === "number" && body.retentionDays >= 0 && body.retentionDays <= 36500
      ? Math.floor(body.retentionDays)
      : 90;

    try {
      const expiresAt = retentionDays > 0
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null;
      const row = await prisma.chatConversation.create({
        data: {
          merchantId,
          ...(title ? { title } : {}),
          retentionDays,
          expiresAt
        }
      });
      res.status(201).json({ success: true, data: { conversation: payloadOf(row) } });
    } catch (err: any) {
      console.error("[chat/conversations.create] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to create conversation" });
    }
  }),

  // GET /:id
  getById: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    try {
      const row = await prisma.chatConversation.findFirst({ where: { id, merchantId } });
      if (!row) { res.status(404).json({ success: false, error: "conversation_not_found" }); return; }
      res.json({ success: true, data: { conversation: payloadOf(row) } });
    } catch (err: any) {
      console.error("[chat/conversations.getById] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load conversation" });
    }
  }),

  // PATCH /:id
  update: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    const body = req.body || {};
    const patch: any = {};

    if (typeof body.title === "string") {
      const t = body.title.trim();
      if (!t) { res.status(400).json({ success: false, error: "title_empty" }); return; }
      patch.title = t.slice(0, MAX_TITLE_LEN);
    }
    if (typeof body.pinned   === "boolean") patch.pinned   = body.pinned;
    if (typeof body.archived === "boolean") patch.archived = body.archived;
    if (typeof body.retentionDays === "number" && body.retentionDays >= 0 && body.retentionDays <= 36500) {
      patch.retentionDays = Math.floor(body.retentionDays);
      patch.expiresAt = patch.retentionDays > 0
        ? new Date(Date.now() + patch.retentionDays * 24 * 60 * 60 * 1000)
        : null;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: "no_valid_fields" });
      return;
    }

    try {
      const result = await prisma.chatConversation.updateMany({
        where: { id, merchantId },
        data:  patch
      });
      if (result.count === 0) { res.status(404).json({ success: false, error: "conversation_not_found" }); return; }
      const fresh = await prisma.chatConversation.findUnique({ where: { id } });
      res.json({ success: true, data: { conversation: fresh ? payloadOf(fresh) : null } });
    } catch (err: any) {
      console.error("[chat/conversations.update] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update conversation" });
    }
  }),

  // DELETE /:id
  remove: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    try {
      const result = await prisma.chatConversation.deleteMany({
        where: { id, merchantId }
      });
      if (result.count === 0) { res.status(404).json({ success: false, error: "conversation_not_found" }); return; }
      res.json({ success: true, data: { deleted: true } });
    } catch (err: any) {
      console.error("[chat/conversations.remove] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to delete conversation" });
    }
  }),

  // GET /:id/messages — paginated
  listMessages: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    try {
      // Verify ownership before reading messages.
      const conv = await prisma.chatConversation.findFirst({
        where:  { id, merchantId },
        select: { id: true }
      });
      if (!conv) { res.status(404).json({ success: false, error: "conversation_not_found" }); return; }

      const limit  = Math.max(1, Math.min(200, parseInt(String(req.query.limit  ?? "50"), 10) || 50));
      const before = req.query.before ? new Date(String(req.query.before)) : null;
      const where: any = { conversationId: id };
      if (before && Number.isFinite(before.getTime())) {
        where.createdAt = { lt: before };
      }

      const rows = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take:    limit
      });
      res.json({
        success: true,
        data: {
          messages: rows.map(messagePayload),
          count:    rows.length
        }
      });
    } catch (err: any) {
      console.error("[chat/conversations.listMessages] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load messages" });
    }
  })
};
