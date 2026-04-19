import { Router } from "express";
import { customerScoreController } from "../controllers/customerScoreController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/summary",      customerScoreController.summary);
router.post("/batch",       customerScoreController.scoreAll);
router.post("/:customerId", customerScoreController.scoreCustomer);

export default router;
