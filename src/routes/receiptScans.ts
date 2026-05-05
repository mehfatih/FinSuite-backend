// ============================================================
// Zyrix FinSuite - Receipt Scan Routes
// Sprint 1 Phase 1A - Feature 2
//
// All routes are authenticated.
//
//   POST   /api/receipts/scan     scan + auto-create expense
//   GET    /api/receipts          list
//   GET    /api/receipts/:id      get one
//   DELETE /api/receipts/:id      delete a scan record
//
// Rate-limit: scan endpoint capped at 30/hour/IP to keep
// Gemini API quota in check during early-stage usage.
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  scanHandler,
  listHandler,
  getHandler,
  deleteHandler,
} from "../controllers/receiptScanController";

const router = Router();

router.use(authenticate as any);

// Rate-limit just the scan endpoint - reads/writes are unrestricted
const scanRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many scans this hour. Please try again later.",
  },
});

router.post("/scan", scanRateLimiter, scanHandler as any);
router.get("/",      listHandler as any);
router.get("/:id",   getHandler as any);
router.delete("/:id", deleteHandler as any);

export default router;
