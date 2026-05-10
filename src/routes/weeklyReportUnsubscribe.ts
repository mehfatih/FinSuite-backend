// ================================================================
// Sprint D-6 — Public weekly-report unsubscribe routes.
// Mounted at /api/weekly-report/unsubscribe; token IS the credential.
// ================================================================
import { Router } from "express";
import { weeklyReportUnsubscribeController } from "../controllers/weeklyReportUnsubscribeController";

const router = Router();

router.get("/info", weeklyReportUnsubscribeController.getInfo);
router.post("/",    weeklyReportUnsubscribeController.apply);

export default router;
