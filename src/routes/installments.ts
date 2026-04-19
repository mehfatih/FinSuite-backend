import { Router } from "express";
import { installmentController } from "../controllers/installmentController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/upcoming",           installmentController.upcoming);
router.get("/",                   installmentController.list);
router.post("/",                  installmentController.create);
router.post("/:installmentId/pay", installmentController.payInstallment);

export default router;
