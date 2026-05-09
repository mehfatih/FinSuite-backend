// ================================================================
// Phase 15 — Customer Cmd+K route.
// Mounted under /api/customer from src/index.ts so the final URL is
// POST /api/customer/cmdk-intent.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { cmdkController } from "../../controllers/customer/cmdkController";

const router = Router();

router.post("/cmdk-intent", authenticate, cmdkController.intent);

export default router;
