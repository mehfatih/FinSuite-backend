import { Router } from "express";
import { factoringController } from "../controllers/factoringController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/eligible",    factoringController.eligibleInvoices);
router.get("/",            factoringController.list);
router.get("/:id",         factoringController.getById);
router.post("/calculate",  factoringController.calculate);
router.post("/apply",      factoringController.apply);
router.post("/:id/cancel", factoringController.cancel);

export default router;
