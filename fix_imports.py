# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Hotfix: Convert default imports to namespace imports
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TARGET = ROOT / "src" / "services" / "provisioningService.ts"

print("=" * 70)
print("FIX IMPORTS in provisioningService.ts")
print("=" * 70)

text = TARGET.read_text(encoding="utf-8")

old1 = 'import bcrypt from "bcrypt";'
new1 = 'import * as bcrypt from "bcrypt";'

old2 = 'import jwt from "jsonwebtoken";'
new2 = 'import * as jwt from "jsonwebtoken";'

ok1 = old1 in text
ok2 = old2 in text

if not ok1:
    print("[FAIL] bcrypt import not found")
    raise SystemExit(1)
if not ok2:
    print("[FAIL] jwt import not found")
    raise SystemExit(1)

text = text.replace(old1, new1, 1)
text = text.replace(old2, new2, 1)

TARGET.write_text(text, encoding="utf-8")

print("[OK] bcrypt: default -> namespace import")
print("[OK] jwt:    default -> namespace import")
print()

# Verification
written = TARGET.read_text(encoding="utf-8")
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
print("     '* as bcrypt' present:  " + str("import * as bcrypt" in written))
print("     '* as jwt' present:     " + str("import * as jwt" in written))
print("     old bcrypt gone:        " + str(old1 not in written))
print("     old jwt gone:           " + str(old2 not in written))
print()
print("=" * 70)
print("[DONE] Imports fixed. Send output to Claude.")
print("=" * 70)