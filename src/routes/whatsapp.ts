// ============================================================
// Zyrix FinSuite - WhatsApp Routes
// Sprint 1 Phase 1B
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  sendInvoiceHandler,
  listHandler,
  getHandler,
} from "../controllers/whatsappController";

const router = Router();

router.use(authenticate as any);

const sendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many WhatsApp messages this hour. Please slow down.",
  },
});

router.post("/send-invoice/:invoiceId", sendRateLimiter, sendInvoiceHandler as any);
router.get("/",     listHandler as any);
router.get("/:id",  getHandler as any);

export default router;
