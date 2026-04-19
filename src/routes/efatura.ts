import { Router } from "express";
import { eFaturaController } from "../controllers/eFaturaController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/stats",       eFaturaController.stats);
router.get("/",            eFaturaController.list);
router.get("/:id",         eFaturaController.getById);
router.get("/:id/xml",     eFaturaController.downloadXML);
router.post("/",           eFaturaController.create);
router.post("/:id/cancel", eFaturaController.cancel);

export default router;
