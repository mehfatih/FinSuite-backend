// ── profile.ts ────────────────────────────────────
import { Router } from "express";
import { profileController } from "../controllers/profileController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/",            profileController.get);
router.put("/",            profileController.update);
router.post("/onboarding", profileController.completeOnboarding);

export default router;