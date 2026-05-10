// ================================================================
// Sprint D-9 — Slack integration routes.
//
// Mounted at /api/integrations/slack from src/index.ts.
//
// Auth split:
//   - OAuth `install` and management endpoints require the merchant JWT.
//   - The OAuth `oauth-callback` is public — `state` (signed JWT) IS the
//     credential.
//   - The two webhook endpoints (commands, interactions) are public —
//     Slack's signing-secret HMAC is the credential. They MUST be mounted
//     with express.raw() so the controller can verify against the exact
//     bytes; express.json() would consume the body before HMAC check.
//
// The webhook routes are wired into the same file as the OAuth routes
// to keep "everything Slack" in one place; the upstream order in
// src/index.ts ensures the auth-required ones get the authenticate
// middleware while the public ones don't.
// ================================================================
import { Router } from "express";
import express from "express";
import { authenticate } from "../../middleware/auth";
import { slackOAuthController } from "../../controllers/integrations/slackOAuthController";
import { slackCommandsController } from "../../controllers/integrations/slackCommandsController";

const router = Router();

// ─── Public OAuth callback (state IS the credential) ─────────
router.get("/oauth-callback", slackOAuthController.callback);

// ─── Public webhook routes (Slack signing-secret HMAC IS the credential) ─
// MUST mount express.raw() per route — express.json() upstream would have
// already consumed the body and the HMAC would never match. Limit guards
// against pathological payloads (Slack's max command body is ~30 KB).
router.post(
  "/commands",
  express.raw({ type: "application/x-www-form-urlencoded", limit: "100kb" }),
  slackCommandsController.handle
);

// ─── Auth-required endpoints ─────────────────────────────────
router.use(authenticate);

router.get("/",                slackOAuthController.list);
router.get("/install",         slackOAuthController.install);
router.post("/uninstall/:id",  slackOAuthController.uninstall);

export default router;
