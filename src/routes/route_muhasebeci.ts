import { Router } from "express";
import { muhasebeciController } from "../controllers/muhasebeciController";
import { merchantAuth } from "../middleware/auth";

const router = Router();

// Public — token bazlı erişim (JWT gerektirmez)
router.get("/access/:token", muhasebeciController.access);
router.get("/export/:token", muhasebeciController.export);

// Protected — merchant JWT gerekli
router.use(merchantAuth);
router.get("/",      muhasebeciController.list);
router.post("/",     muhasebeciController.create);
router.put("/:id",   muhasebeciController.update);
router.delete("/:id", muhasebeciController.revoke);

export default router;