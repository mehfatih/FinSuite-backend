// ============================================================
// Zyrix FinSuite - AI CFO Voice Routes
// Track C - Sprint 2 Feature 1
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  askHandler,
  listHandler,
  getHandler,
  contextHandler,
} from "../controllers/aiCfoVoiceController";

const router = Router();

router.use(authenticate as any);

const askRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many AI questions this hour. Please slow down.",
  },
});

router.post("/ask", askRateLimiter, askHandler as any);
router.get("/conversations", listHandler as any);
router.get("/conversations/:id", getHandler as any);
router.get("/context", contextHandler as any);

export default router;
