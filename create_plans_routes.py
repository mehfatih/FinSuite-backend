# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Step 6: Create src/routes/plans.ts
# Route registration with rate limiting + auth middleware
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
ROUTES_DIR = ROOT / "src" / "routes"
TARGET = ROUTES_DIR / "plans.ts"

print("=" * 70)
print("CREATE src/routes/plans.ts")
print("=" * 70)

if not ROUTES_DIR.exists():
    print("[FAIL] Routes dir not found: " + str(ROUTES_DIR))
    raise SystemExit(1)

# Inspect existing routes to mirror conventions
print("[OK] Routes dir exists")
print()
print("Sample of existing route files:")
existing_routes = sorted([f for f in ROUTES_DIR.iterdir() if f.suffix == ".ts"])
for f in existing_routes[:8]:
    print("     - " + f.name)
print("     (" + str(len(existing_routes)) + " total)")
print()

# Inspect a known route file for the import patterns used in this codebase
auth_route = ROUTES_DIR / "auth.ts"
if auth_route.exists():
    sample = auth_route.read_text(encoding="utf-8")
    print("Detected patterns in auth.ts:")
    print("     authenticateToken import: " + str("authenticateToken" in sample))
    print("     rateLimiter import:       " + str("rateLimiter" in sample or "RateLimit" in sample.lower()))
    print()

if TARGET.exists():
    print("[WARN] plans.ts already exists - will be OVERWRITTEN")
    print()

content = '''// ============================================================
// Zyrix FinSuite — Plans Routes
// Stage 8 Phase B — Auto-Provisioning System
//
// Route table:
//   POST /api/plans/provision   public, rate-limited 5/hour/IP
//   GET  /api/plans/catalog     public
//   POST /api/plans/upgrade     authenticated
//   POST /api/plans/cancel      authenticated
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateToken } from "../middleware/auth";
import {
  provisionHandler,
  catalogHandler,
  upgradeHandler,
  cancelHandler,
} from "../controllers/plansController";

const router = Router();

// ----------------------------------------------------------------
// Rate limiter for /provision: 5 requests per IP per hour
// Prevents account-creation abuse from a single source.
// ----------------------------------------------------------------
const provisionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many signup attempts. Please try again in an hour.",
  },
});

// ----------------------------------------------------------------
// Public routes
// ----------------------------------------------------------------

router.post("/provision", provisionRateLimiter, provisionHandler);
router.get("/catalog", catalogHandler);

// ----------------------------------------------------------------
// Authenticated routes
// ----------------------------------------------------------------

router.post("/upgrade", authenticateToken as any, upgradeHandler as any);
router.post("/cancel", authenticateToken as any, cancelHandler as any);

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
    ("imports Router",            "import { Router } from \"express\"" in written),
    ("imports rateLimit",         "import rateLimit from \"express-rate-limit\"" in written),
    ("imports authenticateToken", "import { authenticateToken }" in written),
    ("imports 4 handlers",        "provisionHandler" in written and "catalogHandler" in written and "upgradeHandler" in written and "cancelHandler" in written),
    ("rate limit 5/hour",         "max: 5" in written and "60 * 60 * 1000" in written),
    ("POST /provision",           'router.post("/provision"' in written),
    ("GET /catalog",              'router.get("/catalog"' in written),
    ("POST /upgrade",             'router.post("/upgrade"' in written),
    ("POST /cancel",              'router.post("/cancel"' in written),
    ("default export",            "export default router" in written),
]
for label, ok in checks:
    print("     " + label.ljust(28) + " -> " + ("OK" if ok else "MISSING"))
print()

print("=" * 70)
print("[DONE] plans.ts created. Send output to Claude.")
print("=" * 70)