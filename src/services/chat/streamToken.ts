// ================================================================
// Sprint D-8 — chat-scoped JWT for SSE auth.
//
// EventSource cannot send Authorization headers, so the client
// flow is:
//   1. POST /api/customer/chat/messages  — user message persisted;
//      response includes a fresh stream token + the placeholder
//      assistant message id (decision §7.D option D1).
//   2. EventSource(/api/customer/chat/stream?token=...&messageId=...)
//      — server verifies token, locates the messageId, runs the
//      engine, streams tokens / tool calls / citations / actions.
//
// Token shape mirrors D-4's streamToken.ts but with a distinct
// issuer so a notification stream token cannot accidentally open
// a chat stream and vice versa.
//
// 5-min TTL is enough for one assistant turn (worst-case ~30s).
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const ISSUER         = "zyrix-finsuite-d8-chat-stream";
const DEFAULT_EXPIRY = "5m";

export interface ChatStreamTokenPayload {
  merchantId:     string;
  conversationId: string;
  messageId:      string;     // placeholder assistant ChatMessage row to fill in
  iat?:           number;
  exp?:           number;
  iss?:           string;
}

export function signChatStreamToken(args: {
  merchantId:     string;
  conversationId: string;
  messageId:      string;
  expiresIn?:     string;
}): string {
  return jwt.sign(
    {
      merchantId:     args.merchantId,
      conversationId: args.conversationId,
      messageId:      args.messageId
    },
    env.jwtSecret,
    { issuer: ISSUER, expiresIn: (args.expiresIn || DEFAULT_EXPIRY) as any }
  );
}

export function verifyChatStreamToken(token: string): ChatStreamTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { issuer: ISSUER }) as ChatStreamTokenPayload;
  if (!decoded.merchantId)     throw new Error("Chat stream token missing merchantId.");
  if (!decoded.conversationId) throw new Error("Chat stream token missing conversationId.");
  if (!decoded.messageId)      throw new Error("Chat stream token missing messageId.");
  return decoded;
}
