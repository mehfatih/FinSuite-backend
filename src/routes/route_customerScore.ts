import { Router } from "express";
import { customerScoreController } from "../controllers/customerScoreController";
import { merchantAuth } from "../middleware/auth";

const router = Router();
router.use(merchantAuth);

router.post("/batch",        customerScoreController.scoreAll);
router.get("/summary",       customerScoreController.summary);
router.post("/:customerId",  customerScoreController.scoreCustomer);

export default router;