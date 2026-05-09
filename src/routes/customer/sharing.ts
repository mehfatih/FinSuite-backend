// ================================================================
// Sprint D-3 — Sharing routes for customer dashboard.
// Mounted at /api/customer/share/* and /api/customer/shares.
// All routes require customer auth.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { sharingController } from "../../controllers/customer/sharingController";

const router = Router();

router.post("/share/email",     authenticate, sharingController.email);
router.post("/share/whatsapp",  authenticate, sharingController.whatsapp);
router.get( "/shares/history",  authenticate, sharingController.history);

export default router;
