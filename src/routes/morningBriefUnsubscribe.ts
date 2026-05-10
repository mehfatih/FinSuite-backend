// ================================================================
// Sprint D-5 — Public morning-brief unsubscribe routes.
// Mounted at /api/morning-brief/unsubscribe; token IS the credential.
// ================================================================
import { Router } from "express";
import { morningBriefUnsubscribeController } from "../controllers/morningBriefUnsubscribeController";

const router = Router();

router.get("/info", morningBriefUnsubscribeController.getInfo);
router.post("/",    morningBriefUnsubscribeController.apply);

export default router;
