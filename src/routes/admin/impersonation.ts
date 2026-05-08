// ================================================================
// Phase 14 — Impersonation routes.
// Mounted under /api/admin from src/routes/admin/index.ts.
// `start` requires admin auth; `exit` and `status` are reached with
// the customer impersonation JWT, so they are NOT behind admin auth.
// ================================================================
import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth";
import { adminImpersonationController } from "../../controllers/admin/adminImpersonationController";

const router = Router();

router.post(
  "/customers/:customerId/impersonate",
  authenticateAdmin as any,
  adminImpersonationController.start
);

router.post("/impersonation/exit",   adminImpersonationController.exit);
router.get( "/impersonation/status", adminImpersonationController.status);

export default router;
