// ============================================================
// Zyrix FinSuite - Bank Routes
// Sprint 1 Phase 1B
// ============================================================

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  providersHandler,
  connectHandler,
  connectionsHandler,
  syncHandler,
  transactionsHandler,
} from "../controllers/bankController";

const router = Router();

router.use(authenticate as any);

router.get("/providers",                   providersHandler as any);
router.post("/connect",                    connectHandler as any);
router.get("/connections",                 connectionsHandler as any);
router.post("/connections/:id/sync",       syncHandler as any);
router.get("/transactions",                transactionsHandler as any);

export default router;
