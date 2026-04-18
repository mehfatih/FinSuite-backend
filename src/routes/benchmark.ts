import { Router } from "express";
import { benchmarkController } from "../controllers/benchmarkController";
import { merchantAuth } from "../middleware/auth";
const router = Router();
router.use(merchantAuth);
router.get("/history", benchmarkController.history);
router.get("/compare", benchmarkController.compare);
router.post("/snapshot", benchmarkController.snapshot);
export default router;