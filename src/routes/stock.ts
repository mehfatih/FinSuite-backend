import { Router } from "express";
import { stockController } from "../controllers/stockController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/summary",       stockController.summary);
router.get("/",              stockController.list);
router.get("/:id",           stockController.getById);
router.post("/",             stockController.create);
router.put("/:id",           stockController.update);
router.post("/:id/movement", stockController.addMovement);

export default router;
