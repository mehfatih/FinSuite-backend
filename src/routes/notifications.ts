// ── notifications.ts ──────────────────────────────
import { Router } from "express";
import { notificationController } from "../controllers/notificationController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/",                  notificationController.list);
router.patch("/read-all",        notificationController.markAllRead);
router.patch("/:id/read",        notificationController.markRead);

export default router;