// ================================================================
// Sprint D-6 — Customer-side weekly report routes.
// All authenticated; mounted at /api/customer/weekly-report.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { weeklyReportController } from "../../controllers/customer/weeklyReportController";

const router = Router();

router.use(authenticate);

router.get("/",                       weeklyReportController.list);
router.get("/subscription",           weeklyReportController.getSubscription);
router.patch("/subscription",         weeklyReportController.updateSubscription);
router.get("/stats",                  weeklyReportController.stats);
router.post("/test",                  weeklyReportController.test);
router.post("/regenerate",            weeklyReportController.regenerate);
router.get("/:id",                    weeklyReportController.getById);
router.get("/:id/pdf",                weeklyReportController.getPdf);

export default router;
