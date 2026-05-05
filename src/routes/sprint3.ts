// ============================================================
// Zyrix FinSuite - Sprint 3 Routes
// User management (RBAC) + Audit Logs + IP Allowlist
// ============================================================

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  listUsersHandler,
  inviteUserHandler,
  updateUserHandler,
  deleteUserHandler,
  rolesCatalogHandler,
  myPermissionsHandler,
  listAuditLogsHandler,
  auditSummaryHandler,
  getAllowlistHandler,
  setAllowlistModeHandler,
  addAllowlistEntryHandler,
  removeAllowlistEntryHandler,
  toggleAllowlistEntryHandler,
} from "../controllers/sprint3Controller";

const router = Router();

router.use(authenticate as any);

// ----------------------------------------------------------------
// Roles catalog (read-only) - any authenticated user can read
// ----------------------------------------------------------------
router.get("/roles", rolesCatalogHandler);
router.get("/me/permissions", myPermissionsHandler as any);

// ----------------------------------------------------------------
// Merchant users (sub-users with RBAC)
// ----------------------------------------------------------------
router.get("/users", listUsersHandler as any);
router.post("/users/invite", inviteUserHandler as any);
router.patch("/users/:id", updateUserHandler as any);
router.delete("/users/:id", deleteUserHandler as any);

// ----------------------------------------------------------------
// Audit logs
// ----------------------------------------------------------------
router.get("/audit-logs", listAuditLogsHandler as any);
router.get("/audit-logs/summary", auditSummaryHandler as any);

// ----------------------------------------------------------------
// IP Allowlist
// ----------------------------------------------------------------
router.get("/ip-allowlist", getAllowlistHandler as any);
router.put("/ip-allowlist/mode", setAllowlistModeHandler as any);
router.post("/ip-allowlist/entries", addAllowlistEntryHandler as any);
router.patch("/ip-allowlist/entries/:id", toggleAllowlistEntryHandler as any);
router.delete("/ip-allowlist/entries/:id", removeAllowlistEntryHandler as any);

export default router;
