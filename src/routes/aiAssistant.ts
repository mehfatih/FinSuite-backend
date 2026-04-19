import { Router } from "express";
import { aiAssistantController } from "../controllers/aiAssistantController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.post("/chat",      aiAssistantController.chat);
router.get("/history",    aiAssistantController.history);
router.delete("/history", aiAssistantController.clearHistory);
router.post("/quick",     aiAssistantController.quick);

export default router;
