import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth";
import { adminAuthController } from "../../controllers/admin/adminAuthController";
import { adminStatsController } from "../../controllers/admin/adminStatsController";
import { adminMerchantsController } from "../../controllers/admin/adminMerchantsController";

const router = Router();

// ─── Public ───────────────────────────────────────────────────
router.post("/login", adminAuthController.login);
router.post("/setup", adminAuthController.setup);

// ─── Protected ────────────────────────────────────────────────
router.use(authenticateAdmin as any);

// Stats
router.get("/stats", adminStatsController.getStats);

// Merchants
router.get("/merchants", adminMerchantsController.list);
router.get("/merchants/:id", adminMerchantsController.getById);
router.put("/merchants/:id/status", adminMerchantsController.updateStatus);
router.put("/merchants/:id/plan", adminMerchantsController.updatePlan);

export default router;
