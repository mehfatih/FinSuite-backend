// ================================================================
// Sprint D-3 — Public share PDF endpoint.
// Mounted at /share/:token from src/index.ts. NO auth middleware —
// the JWT-signed token is the credential. See publicShareController.
// ================================================================
import { Router } from "express";
import { publicShareController } from "../controllers/publicShareController";

const router = Router();

router.get("/:token", publicShareController.getPdf);

export default router;
