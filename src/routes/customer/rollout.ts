// ================================================================
// Sprint D-10 — V2-dashboard rollout flag (auth-required).
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { rolloutController } from "../../controllers/customer/rolloutController";

const router = Router();
router.use(authenticate);

router.get("/v2-dashboard", rolloutController.v2Dashboard);

export default router;
