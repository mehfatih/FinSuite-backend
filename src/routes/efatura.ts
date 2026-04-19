import { Router } from "express";
import { eFaturaController } from "../controllers/eFaturaController";
import { merchantAuth } from "../middleware/auth";

const router = Router();

router.get("/stats", merchantAuth, eFaturaController.stats);
router.get("/", merchantAuth, eFaturaController.list);
router.get("/:id", merchantAuth, eFaturaController.getById);
router.get("/:id/xml", merchantAuth, eFaturaController.downloadXML);
router.post("/", merchantAuth, eFaturaController.create);
router.post("/:id/cancel", merchantAuth, eFaturaController.cancel);

export default router;
