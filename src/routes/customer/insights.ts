// ================================================================
// Sprint D-1 — Insight routes. Mounted under /api/customer/insights.
//   GET   /history
//   PATCH /:id
// All require the standard customer auth middleware.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { insightController } from "../../controllers/customer/insightController";

const router = Router();

router.get(  "/history", authenticate, insightController.history);
router.patch("/:id",     authenticate, insightController.updateStatus);

export default router;
