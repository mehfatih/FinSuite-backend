// ================================================================
// Sprint D-4 — notification preference routes.
// Mounted at /api/customer/preferences/notifications.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { notificationPrefsController } from "../../controllers/customer/notificationPrefsController";

const router = Router();

router.get(   "/notifications", authenticate, notificationPrefsController.get);
router.patch( "/notifications", authenticate, notificationPrefsController.patch);

export default router;
