// ============================================================
// Zyrix FinSuite - e-Irsaliye Routes
// Sprint 1 Phase 1A
//
// All routes are authenticated.
//
//   POST   /api/eirsaliye           create draft
//   GET    /api/eirsaliye           list (filterable by status)
//   GET    /api/eirsaliye/:id       get one
//   PATCH  /api/eirsaliye/:id       update (DRAFT only)
//   POST   /api/eirsaliye/:id/queue build XML + queue for GIB
// ============================================================

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  createHandler,
  listHandler,
  getHandler,
  updateHandler,
  queueHandler,
} from "../controllers/eIrsaliyeController";

const router = Router();

router.use(authenticate as any);

router.post("/",         createHandler as any);
router.get("/",          listHandler as any);
router.get("/:id",       getHandler as any);
router.patch("/:id",     updateHandler as any);
router.post("/:id/queue", queueHandler as any);

export default router;
