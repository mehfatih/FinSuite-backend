// ================================================================
// Sprint D-5 — Customer-side morning brief routes.
// All authenticated; mounted at /api/customer/morning-brief.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { morningBriefController } from "../../controllers/customer/morningBriefController";

const router = Router();

router.use(authenticate);

router.get("/",       morningBriefController.get);
router.patch("/",     morningBriefController.update);
router.post("/test",  morningBriefController.test);
router.get("/stats",  morningBriefController.stats);

export default router;
