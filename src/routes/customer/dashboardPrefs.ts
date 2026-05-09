// ================================================================
// Phase 15 — Customer dashboard preferences routes.
// Mounted under /api/customer/dashboard from src/index.ts.
// All routes require the standard customer auth middleware.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { customerDashboardPrefsController } from "../../controllers/customer/customerDashboardPrefsController";
import { aiBriefController } from "../../controllers/customer/aiBriefController";
import { kpiValuesController } from "../../controllers/customer/kpiValuesController";

const router = Router();

router.get(   "/preferences",      authenticate, customerDashboardPrefsController.getPreferences);
router.patch( "/preferences",      authenticate, customerDashboardPrefsController.updatePreferences);
router.get(   "/preferences/kpis", authenticate, customerDashboardPrefsController.listAvailableKpis);

// Phase 15 — AI Co-Pilot daily brief
router.get(   "/ai-brief",         authenticate, aiBriefController.getBrief);
router.post(  "/ai-brief/refresh", authenticate, aiBriefController.refresh);

// Phase 16 — Real KPI values
router.get(   "/kpi-values",       authenticate, kpiValuesController.getKpiValues);

export default router;
