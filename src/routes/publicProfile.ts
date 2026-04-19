import { Router } from "express";
import { publicProfileController } from "../controllers/publicProfileController";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate as any);
router.get("/qr",  publicProfileController.qr);
router.get("/",    publicProfileController.get);
router.post("/",   publicProfileController.upsert);

export default router;
