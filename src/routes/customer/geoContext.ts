// ================================================================
// Sprint D-11 — Geo-context route (auth-required).
// Mounted under /api/users/me from src/index.ts.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { geoContextController } from "../../controllers/customer/geoContextController";

const router = Router();
router.use(authenticate);

router.get("/geo-context", geoContextController.get);

export default router;
