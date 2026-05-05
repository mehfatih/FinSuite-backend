// ============================================================
// Zyrix FinSuite - WhatsApp Routes
// Sprint 1 Phase 1B
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  sendInvoiceHandler,
  sendPdfHandler,
  sendMediaHandler,
  bulkSendHandler,
  listHandler,
  getHandler,
  webhookVerifyHandler,
  webhookReceiveHandler,
  runRemindersHandler,
  runRemindersForAllHandler,
} from "../controllers/whatsappController";

const router = Router();

// Public webhook routes (no auth - Meta calls these)
router.get("/webhook",  webhookVerifyHandler as any);
router.post("/webhook", webhookReceiveHandler as any);

// Public cron route (protected by CRON_SECRET header inside handler)
router.post("/reminders/run-all", runRemindersForAllHandler as any);

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

const bulkRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many bulk campaigns this hour. Limit: 5/hour.",
  },
});

router.post("/send-invoice/:invoiceId", sendRateLimiter, sendInvoiceHandler as any);
router.post("/send-pdf/:invoiceId",     sendRateLimiter, sendPdfHandler as any);
router.post("/send-media",              sendRateLimiter, sendMediaHandler as any);
router.post("/bulk",                    bulkRateLimiter, bulkSendHandler as any);
router.post("/reminders/run",           sendRateLimiter, runRemindersHandler as any);
router.get("/",     listHandler as any);
router.get("/:id",  getHandler as any);

export default router;
