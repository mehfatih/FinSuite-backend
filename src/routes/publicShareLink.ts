// ================================================================
// Sprint D-7 — Public share link routes (no auth; slug is the credential).
//
// Mounted at:
//   /share/i  → cinematic HTML page
//   /og/share → 1200x630 PNG OG image
//   /api/public/share → view tracking + comment endpoints (B.7)
// ================================================================
import { Router } from "express";
import express from "express";
import { publicShareLinkController } from "../controllers/publicShareLinkController";

const sharePageRouter = Router();

// Password POST submit needs urlencoded form parsing (form action lives in
// the password-gate HTML, NOT JSON).
sharePageRouter.post("/i/:slug",
  express.urlencoded({ extended: false, limit: "10kb" }),
  publicShareLinkController.verifyPassword
);
sharePageRouter.get("/i/:slug",  publicShareLinkController.showPage);

const ogImageRouter = Router();
ogImageRouter.get("/share/:slug", publicShareLinkController.ogImage);

const trackRouter = Router();
trackRouter.post("/share/:slug/track", publicShareLinkController.track);

export { sharePageRouter, ogImageRouter, trackRouter };
