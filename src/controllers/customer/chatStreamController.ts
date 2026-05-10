// ================================================================
// Sprint D-8 — Chat stream endpoints (decision §7.D option D1).
//
// Two-step flow because EventSource cannot send POST bodies:
//
//   POST /api/customer/chat/messages   (auth required)
//     body: { conversationId?, message, lang? }
//     - Creates conversation if conversationId omitted
//     - Persists user message
//     - Creates placeholder assistant ChatMessage row (the engine
//       will fill its content/toolCalls/citations/charts/actions
//       during streaming)
//     - Returns { conversationId, userMessageId, assistantMessageId,
//                streamToken } (5-min JWT)
//
//   GET /api/customer/chat/stream?token=<jwt>   (no auth header — token IS the credential)
//     - Verifies streamToken (merchantId + conversationId + messageId)
//     - Opens SSE response: text/event-stream
//     - Iterates streamChat() generator; writes each chunk as
//       `event: X\ndata: {...}\n\n`
//     - 20-second heartbeat to keep proxies (Cloudflare/Vercel/
//       Railway edge) from closing idle connections
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { signChatStreamToken, verifyChatStreamToken } from "../../services/chat/streamToken";
import { streamChat } from "../../services/chat/engine";
import { writeSseMessage, writeSseKeepalive } from "../../services/notifications/sseHub";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const MAX_MESSAGE_LEN = 8000;
const HEARTBEAT_MS    = 20_000;

function pickLocale(raw: unknown, fallback: string): "tr" | "en" | "ar" {
  const v = String(raw || "").toLowerCase();
  if (v === "tr" || v === "en" || v === "ar") return v;
  const fb = (fallback || "tr").toLowerCase();
  if (fb === "tr" || fb === "en" || fb === "ar") return fb;
  return "tr";
}

export const chatStreamController = {

  // POST /api/customer/chat/messages
  postMessage: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const body = req.body || {};
    const message = String(body.message || "").trim();
    if (!message) {
      res.status(400).json({ success: false, error: "message_required" });
      return;
    }
    if (message.length > MAX_MESSAGE_LEN) {
      res.status(400).json({ success: false, error: "message_too_long" });
      return;
    }

    // Resolve / create conversation. ALWAYS verify ownership.
    let conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    let merchantLocale: string = "tr";
    try {
      const merchant = await prisma.merchant.findUnique({
        where:  { id: merchantId },
        select: { language: true }
      });
      merchantLocale = String(merchant?.language || "TR").toLowerCase();

      if (conversationId) {
        const existing = await prisma.chatConversation.findFirst({
          where:  { id: conversationId, merchantId },
          select: { id: true }
        });
        if (!existing) {
          res.status(404).json({ success: false, error: "conversation_not_found" });
          return;
        }
      } else {
        const created = await prisma.chatConversation.create({
          data: {
            merchantId,
            title:        defaultTitle(message),
            retentionDays: 90,
            expiresAt:    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
          },
          select: { id: true }
        });
        conversationId = created.id;
      }
    } catch (err: any) {
      console.error("[chat/postMessage] conv resolve failed:", err?.message || err);
      res.status(500).json({ success: false, error: "conversation_resolve_failed" });
      return;
    }

    const locale = pickLocale(body.lang, merchantLocale);

    // Persist user message + create placeholder assistant row.
    let userMessageId: string;
    let assistantMessageId: string;
    try {
      const userMsg = await prisma.chatMessage.create({
        data: {
          conversationId,
          role:    "user",
          content: message
        },
        select: { id: true }
      });
      userMessageId = userMsg.id;

      const assistantMsg = await prisma.chatMessage.create({
        data: {
          conversationId,
          role:    "assistant",
          content: ""    // engine fills this during streaming
        },
        select: { id: true }
      });
      assistantMessageId = assistantMsg.id;

      // Bump conversation lastMessageAt + extend expiresAt if not permanent.
      const conv = await prisma.chatConversation.findUnique({
        where: { id: conversationId },
        select: { retentionDays: true }
      });
      const newExpiry = conv && conv.retentionDays > 0
        ? new Date(Date.now() + conv.retentionDays * 24 * 60 * 60 * 1000)
        : null;
      await prisma.chatConversation.update({
        where: { id: conversationId },
        data:  {
          lastMessageAt: new Date(),
          ...(newExpiry !== null ? { expiresAt: newExpiry } : { expiresAt: null })
        }
      });
    } catch (err: any) {
      console.error("[chat/postMessage] persist failed:", err?.message || err);
      res.status(500).json({ success: false, error: "message_persist_failed" });
      return;
    }

    const streamToken = signChatStreamToken({
      merchantId,
      conversationId,
      messageId: assistantMessageId
    });

    res.status(201).json({
      success: true,
      data: {
        conversationId,
        userMessageId,
        assistantMessageId,
        streamToken,
        locale
      }
    });
  }),

  // GET /api/customer/chat/stream?token=...
  // No auth header; token is the credential.
  stream: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const tokenRaw = String(req.query.token || "");
    if (!tokenRaw) {
      res.status(401).type("text/plain").send("missing_token");
      return;
    }

    let payload;
    try {
      payload = verifyChatStreamToken(tokenRaw);
    } catch {
      res.status(401).type("text/plain").send("invalid_or_expired_token");
      return;
    }

    // Verify the placeholder assistant message + conversation belong
    // to the merchant in the token (defence in depth).
    const placeholder = await prisma.chatMessage.findFirst({
      where:  { id: payload.messageId, conversationId: payload.conversationId, role: "assistant" },
      select: { id: true }
    }).catch(() => null);
    if (!placeholder) {
      res.status(404).type("text/plain").send("placeholder_not_found");
      return;
    }
    const conversation = await prisma.chatConversation.findFirst({
      where:  { id: payload.conversationId, merchantId: payload.merchantId },
      select: { id: true }
    }).catch(() => null);
    if (!conversation) {
      res.status(404).type("text/plain").send("conversation_not_found");
      return;
    }

    // Determine locale (URL override > merchant default).
    const localeQ = String(req.query.lang || "");
    const merchant = await prisma.merchant.findUnique({
      where:  { id: payload.merchantId },
      select: { language: true }
    }).catch(() => null);
    const locale = pickLocale(localeQ, String(merchant?.language || "TR").toLowerCase());

    // Open SSE response.
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Initial ready event so the client knows the stream is open.
    writeSseMessage(res, "ready", { conversationId: payload.conversationId, messageId: payload.messageId });

    // Heartbeat ticker.
    const heartbeat = setInterval(() => {
      try { writeSseKeepalive(res); } catch { /* dead socket */ }
    }, HEARTBEAT_MS);

    let clientGone = false;
    req.on("close", () => {
      clientGone = true;
      clearInterval(heartbeat);
    });

    try {
      for await (const chunk of streamChat({
        conversationId:         payload.conversationId,
        placeholderAssistantId: payload.messageId,
        merchantId:             payload.merchantId,
        locale
      })) {
        if (clientGone) break;
        try {
          writeSseMessage(res, chunk.event, chunk.data);
        } catch {
          // Write failed (socket likely closed) — give up gracefully.
          break;
        }
      }
    } catch (err: any) {
      try { writeSseMessage(res, "error", { message: err?.message || String(err) }); } catch { /* ignore */ }
    } finally {
      clearInterval(heartbeat);
      try { res.end(); } catch { /* ignore */ }
    }
  })
};

// ─── Helpers ────────────────────────────────────────────────

function defaultTitle(message: string): string {
  // First non-empty line, truncated to 60 chars. Title auto-gen
  // (B.14) replaces this once the conversation has a few turns.
  const firstLine = message.split(/\r?\n/).find((l) => l.trim().length > 0) || "New Conversation";
  const t = firstLine.trim().slice(0, 60);
  return t || "New Conversation";
}
