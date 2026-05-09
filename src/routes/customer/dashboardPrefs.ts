// ================================================================
// Phase 15 — Customer dashboard preferences routes.
// Mounted under /api/customer/dashboard from src/index.ts.
// All routes require the standard customer auth middleware.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { customerDashboardPrefsController } from "../../controllers/customer/customerDashboardPrefsController";

const router = Router();

router.get(   "/preferences",      authenticate, customerDashboardPrefsController.getPreferences);
router.patch( "/preferences",      authenticate, customerDashboardPrefsController.updatePreferences);
router.get(   "/preferences/kpis", authenticate, customerDashboardPrefsController.listAvailableKpis);

export default router;
