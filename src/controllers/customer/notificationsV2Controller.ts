// ================================================================
// notificationsV2Controller.ts — Sprint D-4 notification endpoints.
//   GET    /api/customer/notifications              list (paginated)
//   GET    /api/customer/notifications/unread-count badge count
//   GET    /api/customer/notifications/stream-token short-lived SSE JWT
//   GET    /api/customer/notifications/stream       SSE stream (token in query)
//   PATCH  /api/customer/notifications/:id/read     mark single read
//   PATCH  /api/customer/notifications/bulk-read    mark all read (or filtered)
//   PATCH  /api/customer/notifications/:id/archive  archive (hide from main feed)
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { signStreamToken, verifyStreamToken } from "../../services/notifications/streamToken";
import { addSubscriber, writeSseMessage, writeSseKeepalive } from "../../services/notifications/sseHub";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const KEEPALIVE_MS  = 30_000;   // 30s — well under Railway's idle timeout
const MAX_LIMIT     = 100;
const DEFAULT_LIMIT = 30;

function commonSelect() {
  return {
    id: true, title: true, body: true, message: true,
    severity: true, iconTone: true, ctaLabel: true, ctaRoute: true,
    insightId: true, shareId: true, channelsSent: true,
    type: true, isRead: true, archived: true,
    readAt: true, createdAt: true, data: true
  } as const;
}

export const notificationsV2Controller = {

  // GET /api/customer/notifications?limit=&before=&unread=true&archived=true
  list: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const limitRaw = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);
      const before = req.query.before ? new Date(String(req.query.before)) : null;
      const unreadOnly  = String(req.query.unread)   === "true";
      const archivedFilter = String(req.query.archived) === "true";

      const where: any = { merchantId: userId, archived: archivedFilter };
      if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
      if (unreadOnly) where.isRead = false;

      const rows = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take:    limit,
        select:  commonSelect()
      });
      res.status(200).json({
        success: true,
        data: { notifications: rows, count: rows.length, limit }
      });
    } catch (err: any) {
      console.error("[notifications/list] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load notifications." });
    }
  }),

  // GET /api/customer/notifications/unread-count
  unreadCount: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const count = await prisma.notification.count({
        where: { merchantId: userId, isRead: false, archived: false }
      });
      res.status(200).json({ success: true, data: { count } });
    } catch (err: any) {
      console.error("[notifications/unread-count] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to count unread." });
    }
  }),

  // GET /api/customer/notifications/stream-token
  streamToken: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const token = signStreamToken(userId);
      res.status(200).json({ success: true, data: { token, expiresInSec: 5 * 60 } });
    } catch (err: any) {
      console.error("[notifications/stream-token] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to issue stream token." });
    }
  }),

  // GET /api/customer/notifications/stream?token=…
  // NOT auth-protected — JWT in `token` query string is the credential.
  stream: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const token = String(req.query.token || "");
    if (!token) { res.status(401).type("text/plain").send("Stream token required."); return; }
    let payload: { merchantId: string };
    try {
      payload = verifyStreamToken(token);
    } catch {
      res.status(401).type("text/plain").send("Stream token invalid or expired.");
      return;
    }
    const merchantId = payload.merchantId;

    // SSE headers.
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    // Welcome event so the client knows the connection is live.
    writeSseMessage(res, "ready", { since: new Date().toISOString() });

    // Subscribe to fanout.
    const unsubscribe = addSubscriber(merchantId, (eventName, payload) => {
      writeSseMessage(res, eventName, payload);
    });

    // Periodic keepalive comment.
    const ping = setInterval(() => {
      try { writeSseKeepalive(res); } catch { /* ignore */ }
    }, KEEPALIVE_MS);

    // Tear down on disconnect.
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
      try { res.end(); } catch { /* ignore */ }
    });
  }),

  // PATCH /api/customer/notifications/:id/read
  markRead: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const id = String(req.params.id || "");
      if (!id) { res.status(400).json({ success: false, error: "Missing notification id." }); return; }

      const existing = await prisma.notification.findFirst({
        where: { id, merchantId: userId }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Notification not found." }); return; }

      const updated = await prisma.notification.update({
        where: { id },
        data:  { isRead: true, readAt: existing.readAt ?? new Date() },
        select: commonSelect()
      });
      res.status(200).json({ success: true, data: { notification: updated } });
    } catch (err: any) {
      console.error("[notifications/markRead] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to mark read." });
    }
  }),

  // PATCH /api/customer/notifications/bulk-read
  bulkRead: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const result = await prisma.notification.updateMany({
        where: { merchantId: userId, isRead: false, archived: false },
        data:  { isRead: true, readAt: new Date() }
      });
      res.status(200).json({ success: true, data: { updated: result.count } });
    } catch (err: any) {
      console.error("[notifications/bulkRead] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to mark all read." });
    }
  }),

  // PATCH /api/customer/notifications/:id/archive
  archive: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const id = String(req.params.id || "");
      if (!id) { res.status(400).json({ success: false, error: "Missing notification id." }); return; }

      const existing = await prisma.notification.findFirst({
        where: { id, merchantId: userId }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Notification not found." }); return; }

      const updated = await prisma.notification.update({
        where: { id },
        data:  { archived: true },
        select: commonSelect()
      });
      res.status(200).json({ success: true, data: { notification: updated } });
    } catch (err: any) {
      console.error("[notifications/archive] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to archive." });
    }
  })
};
