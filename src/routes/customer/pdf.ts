// ================================================================
// Sprint D-2 — PDF generation routes. Mounted under /api/customer/pdf.
//   POST /insight/:insightId
//   POST /daily-brief
//   POST /range-report
// All require the standard customer auth middleware.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { pdfController } from "../../controllers/customer/pdfController";

const router = Router();

router.post("/insight/:insightId", authenticate, pdfController.insight);
router.post("/daily-brief",        authenticate, pdfController.dailyBrief);
router.post("/range-report",       authenticate, pdfController.rangeReport);

export default router;
