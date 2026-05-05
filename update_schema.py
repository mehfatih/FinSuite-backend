# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Sub-step 3: Update schema.prisma locally
# - Backup the file
# - Add E_DONUSUM and ON_MUHASEBE to PlanName enum
# - Change Merchant.plan default from STARTER to E_DONUSUM
# ============================================================

from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"
BACKUP = ROOT / "prisma" / "schema.prisma.backup-stage-8B"

print("=" * 70)
print("UPDATE schema.prisma — Stage 8B")
print("=" * 70)

if not SCHEMA.exists():
    print("[FAIL] schema.prisma not found")
    raise SystemExit(1)

# ----- Backup -----
shutil.copy2(SCHEMA, BACKUP)
print("[OK] Backup created: " + BACKUP.name)
print("     Size: " + str(BACKUP.stat().st_size) + " bytes")
print()

text = SCHEMA.read_text(encoding="utf-8")
original_size = len(text)

# ----- Replace 1: PlanName enum -----
old_enum = """enum PlanName {
  STARTER
  BUSINESS
  PRO
  ENTERPRISE
}"""

new_enum = """enum PlanName {
  E_DONUSUM
  ON_MUHASEBE
  PRO
  ENTERPRISE
  STARTER
  BUSINESS
}"""

if old_enum in text:
    text = text.replace(old_enum, new_enum, 1)
    print("[OK] PlanName enum updated")
    print("     Added: E_DONUSUM, ON_MUHASEBE (kept STARTER, BUSINESS as legacy)")
else:
    print("[FAIL] Could not find original PlanName enum block")
    print("       Aborting — no changes written.")
    raise SystemExit(1)
print()

# ----- Replace 2: Merchant.plan default -----
# Match the field with flexible whitespace
old_default_pattern = re.compile(
    r"(plan\s+PlanName\s+@default\()STARTER(\))"
)

match = old_default_pattern.search(text)
if match:
    text = old_default_pattern.sub(r"\1E_DONUSUM\2", text, count=1)
    print("[OK] Merchant.plan default changed: STARTER -> E_DONUSUM")
else:
    print("[WARN] Could not find Merchant.plan @default(STARTER)")
    print("       Continuing — but verify manually.")
print()

# ----- Write -----
SCHEMA.write_text(text, encoding="utf-8")
new_size = SCHEMA.stat().st_size
print("[OK] schema.prisma written")
print("     Old size: " + str(original_size) + " bytes")
print("     New size: " + str(new_size) + " bytes")
print()

# ----- Verification -----
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
after = SCHEMA.read_text(encoding="utf-8")
print("     E_DONUSUM in file:           " + str("E_DONUSUM" in after))
print("     ON_MUHASEBE in file:         " + str("ON_MUHASEBE" in after))
print("     STARTER still in file:       " + str("STARTER" in after))
print("     BUSINESS still in file:      " + str("BUSINESS" in after))
print("     @default(E_DONUSUM) present: " + str("@default(E_DONUSUM)" in after))
print("     @default(STARTER) gone:      " + str("@default(STARTER)" not in after))
print()
print("=" * 70)
print("[DONE] schema.prisma updated. Send the output above to Claude.")
print("=" * 70)