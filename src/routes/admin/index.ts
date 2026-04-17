import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth";
import { adminAuthController } from "../../controllers/admin/adminAuthController";
import { adminStatsController } from "../../controllers/admin/adminStatsController";
import { adminMerchantsController } from "../../controllers/admin/adminMerchantsController";

const router = Router();

router.post("/login", adminAuthController.login);
router.post("/setup", adminAuthController.setup);

router.use(authenticateAdmin as any);

router.get("/stats", adminStatsController.getStats);
router.post("/admins", adminAuthController.createAdmin);
router.get("/merchants", adminMerchantsController.list);
router.get("/merchants/:id", adminMerchantsController.getById);
router.put("/merchants/:id/status", adminMerchantsController.updateStatus);
router.put("/merchants/:id/plan", adminMerchantsController.updatePlan);

export default router;
