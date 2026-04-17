import { Router } from "express";
import { dealController } from "../controllers/dealController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/", dealController.list);
router.get("/:id", dealController.getById);
router.post("/", dealController.create);
router.put("/:id", dealController.update);
router.delete("/:id", dealController.delete);

export default router;
