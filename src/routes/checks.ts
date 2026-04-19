import { Router } from "express";
import { checkController } from "../controllers/checkController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/summary",        checkController.summary);
router.get("/upcoming",       checkController.upcoming);
router.get("/",               checkController.list);
router.post("/",              checkController.create);
router.patch("/:id/status",   checkController.updateStatus);

export default router;
