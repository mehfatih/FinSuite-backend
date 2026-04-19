import { Router } from "express";
import { benchmarkController } from "../controllers/benchmarkController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/history",  benchmarkController.history);
router.get("/compare",  benchmarkController.compare);
router.post("/snapshot", benchmarkController.snapshot);

export default router;
