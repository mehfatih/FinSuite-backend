import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth";
import { adminAuthController } from "../../controllers/admin/adminAuthController";
import { adminStatsController } from "../../controllers/admin/adminStatsController";
import { adminMerchantsController } from "../../controllers/admin/adminMerchantsController";
import { adminEmailEngagementController } from "../../controllers/admin/adminEmailEngagementController";
import { adminAiUsageController } from "../../controllers/admin/adminAiUsageController";
import { adminTaxRatesController } from "../../controllers/admin/adminTaxRatesController";
import impersonationRouter from "./impersonation";

const router = Router();

router.post("/login",  adminAuthController.login);
router.post("/setup",  adminAuthController.setup);

// Impersonation routes mount BEFORE the global authenticateAdmin: the
// `start` endpoint applies admin auth itself (per-route), while
// `/impersonation/exit` and `/impersonation/status` use the customer
// impersonation JWT, not the admin token.
router.use(impersonationRouter);

router.use(authenticateAdmin as any);

router.get("/stats",   adminStatsController.getStats);
router.post("/admins", adminAuthController.createAdmin);

// ── Merchants ─────────────────────────────────────
router.get("/merchants",                          adminMerchantsController.list);
router.post("/merchants",                         adminMerchantsController.create);
router.get("/merchants/:id",                      adminMerchantsController.getById);
router.patch("/merchants/:id",                    adminMerchantsController.update);
router.put("/merchants/:id/status",               adminMerchantsController.updateStatus);
router.put("/merchants/:id/plan",                 adminMerchantsController.updatePlan);
router.post("/merchants/:id/extend-trial",        adminMerchantsController.extendTrial);
router.post("/merchants/:id/notify",              adminMerchantsController.sendNotification);
router.post("/merchants/:id/archive",             adminMerchantsController.archive);
router.post("/merchants/:id/unarchive",           adminMerchantsController.unarchive);
router.post("/merchants/:id/reset-password",      adminMerchantsController.resetPassword);
router.get("/merchants/:id/audit",                adminMerchantsController.getAuditLog);
router.delete("/merchants/:id",                   adminMerchantsController.delete);

// Sprint D-5 — morning brief engagement dashboard
router.get("/email-engagement",                              adminEmailEngagementController.getStats);
router.get("/email-engagement/bounced",                      adminEmailEngagementController.getBounced);
router.post("/email-engagement/:merchantId/re-enable",       adminEmailEngagementController.reEnable);

// Sprint D-10 — AI usage observability (D-8 ChatMessage tokens columns).
router.get("/ai-usage/summary",        adminAiUsageController.summary);
router.get("/ai-usage/daily",          adminAiUsageController.daily);
router.get("/ai-usage/top-merchants",  adminAiUsageController.topMerchants);
router.get("/ai-usage/latency",        adminAiUsageController.latency);

// Sprint D-11 — Effective-dated tax rate version CRUD (audit-logged).
router.get("/regulatory/tax-rates",         adminTaxRatesController.list);
router.post("/regulatory/tax-rates",        adminTaxRatesController.create);
router.patch("/regulatory/tax-rates/:id",   adminTaxRatesController.update);
router.delete("/regulatory/tax-rates/:id",  adminTaxRatesController.remove);

export default router;