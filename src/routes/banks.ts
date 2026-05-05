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
  importCsvHandler,
  listImportsHandler,
} from "../controllers/bankController";

const router = Router();

router.use(authenticate as any);

router.get("/providers",                   providersHandler as any);
router.post("/connect",                    connectHandler as any);
router.get("/connections",                 connectionsHandler as any);
router.post("/connections/:id/sync",       syncHandler as any);
router.get("/transactions",                transactionsHandler as any);
router.post("/import-csv",                 importCsvHandler as any);
router.get("/imports",                     listImportsHandler as any);

export default router;
