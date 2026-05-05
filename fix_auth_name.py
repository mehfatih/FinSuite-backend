from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TARGET = ROOT / "src" / "routes" / "plans.ts"

print("=" * 70)
print("FIX: rename authenticateToken -> authenticate in plans.ts")
print("=" * 70)

text = TARGET.read_text(encoding="utf-8")

old1 = 'import { authenticateToken } from "../middleware/auth";'
new1 = 'import { authenticate } from "../middleware/auth";'

old2 = 'router.post("/upgrade", authenticateToken as any, upgradeHandler as any);'
new2 = 'router.post("/upgrade", authenticate as any, upgradeHandler as any);'

old3 = 'router.post("/cancel", authenticateToken as any, cancelHandler as any);'
new3 = 'router.post("/cancel", authenticate as any, cancelHandler as any);'

ok1 = old1 in text
ok2 = old2 in text
ok3 = old3 in text

if not (ok1 and ok2 and ok3):
    print("[FAIL] One or more anchors missing:")
    print("     import line found:  " + str(ok1))
    print("     upgrade line found: " + str(ok2))
    print("     cancel line found:  " + str(ok3))
    raise SystemExit(1)

text = text.replace(old1, new1, 1)
text = text.replace(old2, new2, 1)
text = text.replace(old3, new3, 1)

TARGET.write_text(text, encoding="utf-8")
print("[OK] All 3 references updated")
print()

# Verification
written = TARGET.read_text(encoding="utf-8")
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
print("     authenticateToken gone:    " + str("authenticateToken" not in written))
print("     authenticate import:       " + str('import { authenticate }' in written))
print("     upgrade uses authenticate: " + str("authenticate as any, upgradeHandler" in written))
print("     cancel uses authenticate:  " + str("authenticate as any, cancelHandler" in written))
print()
print("=" * 70)
print("[DONE] Send output to Claude.")
print("=" * 70)