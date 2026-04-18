import { Router } from "express";
import { aiAssistantController } from "../controllers/aiAssistantController";
import { merchantAuth } from "../middleware/auth";

const router = Router();
router.use(merchantAuth);

router.post("/chat",      aiAssistantController.chat);
router.get("/history",    aiAssistantController.history);
router.delete("/history", aiAssistantController.clearHistory);
router.post("/quick",     aiAssistantController.quick);

export default router;