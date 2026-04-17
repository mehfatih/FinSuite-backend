import { Router } from "express";
import { taskController } from "../controllers/taskController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);
router.get("/", taskController.list);
router.post("/", taskController.create);
router.put("/:id", taskController.update);
router.delete("/:id", taskController.delete);

export default router;
