// ================================================================
// Sprint D-4 — Resend webhook route.
// Mounted at /api/webhooks/resend (public; HMAC-verified inside).
// Uses express.raw() so the controller has access to the raw body
// for signature verification — express.json() WOULD eat it.
// ================================================================
import { Router } from "express";
import express from "express";
import { resendWebhookController } from "../../controllers/webhooks/resendWebhookController";

const router = Router();

router.post(
  "/resend",
  express.raw({ type: "application/json", limit: "100kb" }),
  resendWebhookController.handle
);

export default router;
