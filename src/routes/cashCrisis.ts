// ============================================================
// Zyrix FinSuite - Cash Crisis Routes
// Track C - Sprint 2 Feature 2
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  listActiveHandler,
  listAllHandler,
  analyzeHandler,
  dismissHandler,
  resolveHandler,
} from "../controllers/cashCrisisController";

const router = Router();
router.use(authenticate as any);

const analyzeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Analysis can be run at most 10 times per hour.",
  },
});

router.get("/",                  listActiveHandler as any);
router.get("/all",               listAllHandler as any);
router.post("/analyze",          analyzeRateLimiter, analyzeHandler as any);
router.post("/:id/dismiss",      dismissHandler as any);
router.post("/:id/resolve",      resolveHandler as any);

export default router;
