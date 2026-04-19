import { Router } from "express";
import { muhasebeciController } from "../controllers/muhasebeciController";
import { authenticate } from "../middleware/auth";

const router = Router();

router.get("/access/:token", muhasebeciController.access);
router.get("/export/:token", muhasebeciController.export);

router.use(authenticate as any);
router.get("/",       muhasebeciController.list);
router.post("/",      muhasebeciController.create);
router.put("/:id",    muhasebeciController.update);
router.delete("/:id", muhasebeciController.revoke);

export default router;
