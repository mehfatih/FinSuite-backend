// ============================================================
// Zyrix FinSuite - Marketplace Routes
// Track C - Sprint 2 Feature 4
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  providersHandler,
  connectHandler,
  connectionsHandler,
  syncOneHandler,
  syncAllHandler,
  ordersHandler,
  settlementsHandler,
  disconnectHandler,
} from "../controllers/marketplaceController";

const router = Router();
router.use(authenticate as any);

const syncRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Sync can be run at most 30 times per hour.",
  },
});

router.get("/providers",          providersHandler as any);
router.post("/connect",           connectHandler as any);
router.get("/connections",        connectionsHandler as any);
router.post("/sync/:id",          syncRateLimiter, syncOneHandler as any);
router.post("/sync-all",          syncRateLimiter, syncAllHandler as any);
router.get("/orders",             ordersHandler as any);
router.get("/settlements",        settlementsHandler as any);
router.delete("/connection/:id",  disconnectHandler as any);

export default router;
