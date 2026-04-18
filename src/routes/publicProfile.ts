import { Router } from "express";
import { publicProfileController } from "../controllers/publicProfileController";
import { merchantAuth } from "../middleware/auth";
const router = Router();
router.use(merchantAuth);
router.get("/", publicProfileController.get);
router.post("/", publicProfileController.upsert);
router.get("/qr", publicProfileController.qr);
export default router;