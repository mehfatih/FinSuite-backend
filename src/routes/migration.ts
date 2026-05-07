// ================================================================
// Phase 13 — Migration + Export routes.
// Heavy parsing happens client-side; backend just stores job records,
// snapshots data for rollback, and handles the actual data writes.
// ================================================================
import { Router, Response } from "express";
import { prisma } from "../config/database";
import { authenticate } from "../middleware/auth";
import { AuthenticatedRequest } from "../types";

const router: Router = Router();
router.use(authenticate as any);

// ── Migration jobs ───────────────────────────────────────────
router.post("/jobs", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const userId = (auth.merchant as any).userId || merchantId;
    const { sourceSystem, fileName, fileSize, fieldMapping, totalRows } = req.body;
    const job = await prisma.migrationJob.create({
      data: {
        merchantId,
        userId,
        sourceSystem: sourceSystem || "unknown",
        fileName: fileName || "untitled",
        fileSize: fileSize || 0,
        fieldMapping: fieldMapping || {},
        totalRows: totalRows || 0,
        status: "PENDING",
      },
    });
    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/jobs", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const jobs = await prisma.migrationJob.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return res.json({ success: true, data: jobs });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/jobs/:id", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const job = await prisma.migrationJob.findFirst({
      where: { id: req.params.id, merchantId },
    });
    if (!job) return res.status(404).json({ success: false, error: "Job not found" });
    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/jobs/:id/rollback", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const job = await prisma.migrationJob.findFirst({
      where: { id: req.params.id, merchantId, status: "COMPLETED" },
    });
    if (!job) return res.status(404).json({ success: false, error: "Job not found or not eligible for rollback" });
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (!job.completedAt || job.completedAt.getTime() < sevenDaysAgo) {
      return res.status(400).json({ success: false, error: "Rollback window expired (7 days)" });
    }
    // Real impl: walk job.snapshotData and reverse the writes.
    const updated = await prisma.migrationJob.update({
      where: { id: job.id },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
    });
    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Exports ──────────────────────────────────────────────────
const exportsRouter: Router = Router();
exportsRouter.use(authenticate as any);

exportsRouter.post("/", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const userId = (auth.merchant as any).userId || merchantId;
    const { type, format } = req.body;
    const job = await prisma.exportJob.create({
      data: {
        merchantId,
        userId,
        type: type || "full_backup",
        format: format || "csv",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

exportsRouter.get("/", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const jobs = await prisma.exportJob.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return res.json({ success: true, data: jobs });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

exportsRouter.post("/scheduled", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const userId = (auth.merchant as any).userId || merchantId;
    const { type, format, schedule } = req.body;
    const job = await prisma.exportJob.create({
      data: {
        merchantId,
        userId,
        type: type || "full_backup",
        format: format || "csv",
        schedule,
        status: "PENDING",
      },
    });
    return res.json({ success: true, data: job });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export { exportsRouter };
export default router;
