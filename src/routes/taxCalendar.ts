import { Router } from "express";
import { taxCalendarController } from "../controllers/taxCalendarController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/upcoming", taxCalendarController.upcoming);
router.get("/",         taxCalendarController.list);
router.post("/generate", taxCalendarController.generate);
router.patch("/:id",    taxCalendarController.updateStatus);

export default router;
