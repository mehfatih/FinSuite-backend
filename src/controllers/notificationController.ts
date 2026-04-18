import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const notificationController = {

  // GET /api/notifications
  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notifications = await prisma.notification.findMany({
        where: { merchantId: req.merchant!.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const unreadCount = notifications.filter(n => !n.isRead).length;
      res.json({ success: true, data: { notifications, unreadCount } });
    } catch { res.status(500).json({ success: false, error: "Failed" }); }
  }),

  // PATCH /api/notifications/:id/read
  markRead: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.notification.update({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        data: { isRead: true },
      });
      res.json({ success: true });
    } catch { res.status(500).json({ success: false, error: "Failed" }); }
  }),

  // PATCH /api/notifications/read-all
  markAllRead: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      await prisma.notification.updateMany({
        where: { merchantId: req.merchant!.id, isRead: false },
        data: { isRead: true },
      });
      res.json({ success: true });
    } catch { res.status(500).json({ success: false, error: "Failed" }); }
  }),
};