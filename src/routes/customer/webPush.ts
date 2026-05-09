// ================================================================
// Sprint D-4 — Web Push subscription routes.
// Mounted at /api/customer/web-push.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { webPushController } from "../../controllers/customer/webPushController";

const router = Router();

router.get(   "/vapid-key",   authenticate, webPushController.vapidKey);
router.post(  "/subscribe",   authenticate, webPushController.subscribe);
router.delete("/unsubscribe", authenticate, webPushController.unsubscribe);

export default router;
