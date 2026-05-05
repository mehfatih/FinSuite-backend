# ============================================================
# Sprint 1 Phase 1A - Step 4
# Create src/routes/eIrsaliye.ts
# 5 routes, all authenticated
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TARGET = ROOT / "src" / "routes" / "eIrsaliye.ts"

print("=" * 70)
print("CREATE src/routes/eIrsaliye.ts")
print("=" * 70)

if TARGET.exists():
    print("[WARN] File already exists - will be OVERWRITTEN")
    print()

content = '''// ============================================================
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
'''

TARGET.write_text(content, encoding="utf-8")
print("[OK] File written: " + str(TARGET))
print("     Size: " + str(TARGET.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
written = TARGET.read_text(encoding="utf-8")
checks = [
    ("imports authenticate",   "import { authenticate }" in written),
    ("imports 5 handlers",     all(h in written for h in ["createHandler", "listHandler", "getHandler", "updateHandler", "queueHandler"])),
    ("router.use(authenticate)", "router.use(authenticate as any)" in written),
    ("POST / create",          'router.post("/",' in written),
    ("GET / list",             'router.get("/",' in written),
    ("GET /:id",               'router.get("/:id"' in written),
    ("PATCH /:id",             'router.patch("/:id"' in written),
    ("POST /:id/queue",        'router.post("/:id/queue"' in written),
    ("default export",         "export default router" in written),
]
for label, ok in checks:
    print("     " + label.ljust(28) + " -> " + ("OK" if ok else "MISSING"))
print()
print("=" * 70)
