import { Router } from "express";
import { factoringController } from "../controllers/factoringController";
import { merchantAuth } from "../middleware/auth";

const router = Router();
router.use(merchantAuth);

router.get("/",             factoringController.list);
router.get("/eligible",     factoringController.eligibleInvoices);
router.get("/:id",          factoringController.getById);
router.post("/calculate",   factoringController.calculate);
router.post("/apply",       factoringController.apply);
router.post("/:id/cancel",  factoringController.cancel);

export default router;