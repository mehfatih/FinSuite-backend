// ── payments.ts ───────────────────────────────────
import { Router } from "express";
import { paymentController } from "../controllers/paymentController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/plans",        paymentController.getPlans);
router.get("/subscription", paymentController.getSubscription);
router.post("/initiate",    paymentController.initiate);

export default router;