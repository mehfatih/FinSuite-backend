// ============================================================
// Zyrix FinSuite — Plans Routes
// Stage 8 Phase B — Auto-Provisioning System
//
// Route table:
//   POST /api/plans/provision   public, rate-limited 5/hour/IP
//   GET  /api/plans/catalog     public
//   POST /api/plans/upgrade     authenticated
//   POST /api/plans/cancel      authenticated
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  provisionHandler,
  catalogHandler,
  upgradeHandler,
  cancelHandler,
} from "../controllers/plansController";

const router = Router();

// ----------------------------------------------------------------
// Rate limiter for /provision: 5 requests per IP per hour
// Prevents account-creation abuse from a single source.
// ----------------------------------------------------------------
const provisionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many signup attempts. Please try again in an hour.",
  },
});

// ----------------------------------------------------------------
// Public routes
// ----------------------------------------------------------------

router.post("/provision", provisionRateLimiter, provisionHandler);
router.get("/catalog", catalogHandler);

// ----------------------------------------------------------------
// Authenticated routes
// ----------------------------------------------------------------

router.post("/upgrade", authenticate as any, upgradeHandler as any);
router.post("/cancel", authenticate as any, cancelHandler as any);

export default router;
