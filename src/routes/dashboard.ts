import { Router } from "express";
import { dashboardController } from "../controllers/dashboardController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/stats", dashboardController.getStats);

export default router;
