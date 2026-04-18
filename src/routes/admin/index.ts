import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth";
import { adminAuthController } from "../../controllers/admin/adminAuthController";
import { adminStatsController } from "../../controllers/admin/adminStatsController";
import { adminMerchantsController } from "../../controllers/admin/adminMerchantsController";

const router = Router();

router.post("/login",  adminAuthController.login);
router.post("/setup",  adminAuthController.setup);

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

export default router;