import { Router } from "express";
import { invoiceController } from "../controllers/invoiceController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/", invoiceController.list);
router.get("/:id", invoiceController.getById);
router.post("/", invoiceController.create);
router.put("/:id", invoiceController.update);
router.put("/:id/paid", invoiceController.markPaid);
router.delete("/:id", invoiceController.delete);

export default router;
