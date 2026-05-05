# ============================================================
# Update version string in src/index.ts
# v3.0 -> v3.1, 15 features -> 16 features, 25 routes -> 26 routes
# ============================================================

from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
INDEX = ROOT / "src" / "index.ts"

print("=" * 70)
print("UPDATE version string in src/index.ts")
print("=" * 70)

text = INDEX.read_text(encoding="utf-8")
original = text

# Show current version lines
print()
print("Current matching lines:")
for line_num, line in enumerate(text.splitlines(), 1):
    if "Zyrix FinSuite" in line and ("v3" in line or "port" in line.lower()):
        print("     L" + str(line_num) + ": " + line.strip())
    if "features" in line and "routes" in line:
        print("     L" + str(line_num) + ": " + line.strip())
print()

# ---- Replacement 1: version label ----
old1_a = "Zyrix FinSuite v3.0"
new1_a = "Zyrix FinSuite v3.1"

# ---- Replacement 2: features/routes count ----
old2_a = "15 features | 25 routes"
new2_a = "16 features | 26 routes"

ok1 = old1_a in text
ok2 = old2_a in text

if ok1:
    text = text.replace(old1_a, new1_a)
    print("[OK] v3.0 -> v3.1")
else:
    print("[WARN] 'Zyrix FinSuite v3.0' not found - skipping")

if ok2:
    text = text.replace(old2_a, new2_a)
    print("[OK] 15 features | 25 routes -> 16 features | 26 routes")
else:
    print("[WARN] '15 features | 25 routes' not found - skipping")

if text != original:
    INDEX.write_text(text, encoding="utf-8")
    print()
    print("[OK] index.ts updated")
else:
    print()
    print("[OK] No changes (already up to date or strings differ)")

# Verification
print()
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = INDEX.read_text(encoding="utf-8")
print("     v3.1 present:                 " + str("v3.1" in final))
print("     '16 features | 26 routes':    " + str("16 features | 26 routes" in final))
print()
print("=" * 70)
print("[DONE] Send output to Claude.")
print("=" * 70)