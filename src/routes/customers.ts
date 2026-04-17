import { Router } from "express";
import { customerController } from "../controllers/customerController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/", customerController.list);
router.get("/:id", customerController.getById);
router.post("/", customerController.create);
router.put("/:id", customerController.update);
router.delete("/:id", customerController.delete);
router.post("/:id/loyalty", customerController.addLoyaltyPoints);

export default router;
