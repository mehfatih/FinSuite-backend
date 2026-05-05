// ============================================================
// Zyrix FinSuite - Trendyol Routes
// Track C - Sprint 2 Feature 3
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  connectHandler,
  connectionHandler,
  syncHandler,
  ordersHandler,
  settlementsHandler,
  disconnectHandler,
} from "../controllers/trendyolController";

const router = Router();
router.use(authenticate as any);

const syncRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Sync can be run at most 12 times per hour.",
  },
});

router.post("/connect",        connectHandler as any);
router.get("/connection",      connectionHandler as any);
router.post("/sync",           syncRateLimiter, syncHandler as any);
router.get("/orders",          ordersHandler as any);
router.get("/settlements",     settlementsHandler as any);
router.delete("/connection",   disconnectHandler as any);

export default router;
