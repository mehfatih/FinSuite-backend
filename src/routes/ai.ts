import { Router } from "express";
import { aiController } from "../controllers/aiController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.post("/chat", aiController.chat);
router.get("/conversations", aiController.getConversations);
router.get("/conversations/:id", aiController.getConversation);
router.get("/cashflow-forecast", aiController.cashFlowForecast);

export default router;
