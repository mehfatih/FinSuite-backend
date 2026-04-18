// ── src/routes/efatura.ts ────────────────────────────────────
import { Router } from "express";
import { eFaturaController } from "../controllers/eFaturaController";
import { merchantAuth } from "../middleware/auth";

const router = Router();
router.use(merchantAuth);

router.get("/",            eFaturaController.list);
router.get("/stats",       eFaturaController.stats);
router.get("/:id",         eFaturaController.getById);
router.get("/:id/xml",     eFaturaController.downloadXML);
router.post("/",           eFaturaController.create);
router.post("/:id/cancel", eFaturaController.cancel);

export default router;