# ============================================================
# Diagnostic: Inspect Merchant, Subscription, FeatureFlag, AuditLog
# Read-only. Prints field names so we can match them in code.
# ============================================================

from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"

text = SCHEMA.read_text(encoding="utf-8")

MODELS = ["Merchant", "Subscription", "FeatureFlag", "AuditLog"]

print("=" * 70)
print("MODEL FIELD DIAGNOSTIC")
print("=" * 70)

for model in MODELS:
    print()
    print("-" * 70)
    print("MODEL: " + model)
    print("-" * 70)

    pattern = r"model\s+" + model + r"\s*\{([^}]*)\}"
    m = re.search(pattern, text, flags=re.DOTALL)
    if not m:
        print("[FAIL] Not found")
        continue

    body = m.group(1)
    print(body.strip())
print()
print("=" * 70)
print("[DONE] Send the entire output to Claude.")
print("=" * 70)