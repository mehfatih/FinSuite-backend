# ============================================================
# Sprint 1 Phase 1A - Feature 2 / Step 3
# Create src/routes/receiptScans.ts + wire into index.ts
# ============================================================

from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
ROUTE = ROOT / "src" / "routes" / "receiptScans.ts"
INDEX = ROOT / "src" / "index.ts"
BACKUP = ROOT / "src" / "index.ts.backup-sprint1-1A-feature2"

# ============================================================
# Part 1: Create the routes file
# ============================================================
print("=" * 70)
print("CREATE src/routes/receiptScans.ts")
print("=" * 70)

route_content = '''// ============================================================
// Zyrix FinSuite - Receipt Scan Routes
// Sprint 1 Phase 1A - Feature 2
//
// All routes are authenticated.
//
//   POST   /api/receipts/scan     scan + auto-create expense
//   GET    /api/receipts          list
//   GET    /api/receipts/:id      get one
//   DELETE /api/receipts/:id      delete a scan record
//
// Rate-limit: scan endpoint capped at 30/hour/IP to keep
// Gemini API quota in check during early-stage usage.
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  scanHandler,
  listHandler,
  getHandler,
  deleteHandler,
} from "../controllers/receiptScanController";

const router = Router();

router.use(authenticate as any);

// Rate-limit just the scan endpoint - reads/writes are unrestricted
const scanRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many scans this hour. Please try again later.",
  },
});

router.post("/scan", scanRateLimiter, scanHandler as any);
router.get("/",      listHandler as any);
router.get("/:id",   getHandler as any);
router.delete("/:id", deleteHandler as any);

export default router;
'''

ROUTE.write_text(route_content, encoding="utf-8")
print("[OK] Route file written: " + str(ROUTE))
print("     Size: " + str(ROUTE.stat().st_size) + " bytes")
print()

# ============================================================
# Part 2: Wire into index.ts
# ============================================================
print("=" * 70)
print("WIRE receiptScans routes into src/index.ts")
print("=" * 70)

shutil.copy2(INDEX, BACKUP)
print("[OK] Backup: " + BACKUP.name)
print()

text = INDEX.read_text(encoding="utf-8")
original = text

if 'from "./routes/receiptScans"' in text:
    print("[WARN] Route already wired")

# Find existing imports
import_lines = re.findall(r'^import\s+\w+\s+from\s+"\./routes/[^"]+";?$', text, flags=re.MULTILINE)
use_lines = re.findall(r'^app\.use\("/api/[^"]+",\s*\w+\);?$', text, flags=re.MULTILINE)

new_import = 'import receiptScansRoutes from "./routes/receiptScans";'
new_use = 'app.use("/api/receipts", receiptScansRoutes);'

if new_import not in text:
    if not import_lines:
        print("[FAIL] No existing route imports found")
        raise SystemExit(1)
    last_import = import_lines[-1]
    text = text.replace(last_import, last_import + "\n" + new_import, 1)
    print("[OK] Inserted import after: " + last_import)

if new_use not in text:
    if not use_lines:
        print("[FAIL] No existing app.use found")
        raise SystemExit(1)
    last_use = use_lines[-1]
    text = text.replace(last_use, last_use + "\n" + new_use, 1)
    print("[OK] Inserted route registration")

# Update version + counters
text = text.replace("Zyrix FinSuite v3.2", "Zyrix FinSuite v3.3", 1)
text = text.replace("17 features | 27 routes", "18 features | 28 routes", 1)

if text != original:
    INDEX.write_text(text, encoding="utf-8")
    print("[OK] index.ts updated")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = INDEX.read_text(encoding="utf-8")
print("     receiptScansRoutes import:    " + str(new_import in final))
print("     /api/receipts registered:     " + str(new_use in final))
print("     Version v3.3:                 " + str("v3.3" in final))
print("     18 features | 28 routes:      " + str("18 features | 28 routes" in final))
print()

route_text = ROUTE.read_text(encoding="utf-8")
print("Route file checks:")
print("     scanRateLimiter present:      " + str("scanRateLimiter" in route_text))
print("     POST /scan registered:        " + str('router.post("/scan"' in route_text))
print("     GET / registered:             " + str('router.get("/",' in route_text))
print("     GET /:id registered:          " + str('router.get("/:id"' in route_text))
print("     DELETE /:id registered:       " + str('router.delete("/:id"' in route_text))
print()
print("=" * 70)
