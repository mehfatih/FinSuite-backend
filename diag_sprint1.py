from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"

text = SCHEMA.read_text(encoding="utf-8")

print("=" * 70)
print("DIAGNOSTIC: Sprint 1 Phase 1A schema design")
print("=" * 70)
print()

# Show EFatura model in full
print("-" * 70)
print("EXISTING MODEL: EFatura (template for EIrsaliye)")
print("-" * 70)
m = re.search(r"model\s+EFatura\s*\{([^}]*)\}", text, flags=re.DOTALL)
if m:
    print(m.group(0))
else:
    print("[NOT FOUND]")
print()

# Show Expense model
print("-" * 70)
print("EXISTING MODEL: Expense (target for Receipt OCR)")
print("-" * 70)
m = re.search(r"model\s+Expense\s*\{([^}]*)\}", text, flags=re.DOTALL)
if m:
    print(m.group(0))
else:
    print("[NOT FOUND]")
print()

# Show all status-like enums
print("-" * 70)
print("EXISTING ENUMS (for status field consistency)")
print("-" * 70)
for em in re.finditer(r"enum\s+(\w+)\s*\{([^}]*)\}", text, flags=re.DOTALL):
    name = em.group(1)
    if "Status" in name or "Stage" in name or "Type" in name:
        body = em.group(2).strip()
        print()
        print("enum " + name + " {")
        print("  " + body.replace("\n", "\n  "))
        print("}")
print()

# Check if EIrsaliye or ReceiptScan already exist
print("-" * 70)
print("PRE-CHECK: target models")
print("-" * 70)
print("  EIrsaliye exists:   " + str(bool(re.search(r"model\s+EIrsaliye\s*\{", text))))
print("  ReceiptScan exists: " + str(bool(re.search(r"model\s+ReceiptScan\s*\{", text))))
print("  EIrsaliyeStatus enum exists: " + str(bool(re.search(r"enum\s+EIrsaliyeStatus\s*\{", text))))
print("  ReceiptScanStatus enum exists: " + str(bool(re.search(r"enum\s+ReceiptScanStatus\s*\{", text))))
print()

# Check the merchants relations list to know where to add new relations
print("-" * 70)
print("Merchant model: relations area (last 20 lines of model)")
print("-" * 70)
m = re.search(r"model\s+Merchant\s*\{([^}]*)\}", text, flags=re.DOTALL)
if m:
    body_lines = m.group(1).strip().splitlines()
    for ln in body_lines[-25:]:
        print("  " + ln)
print()

# Schema size
print("-" * 70)
print("Schema info: " + str(SCHEMA.stat().st_size) + " bytes, " + str(text.count(chr(10)) + 1) + " lines")
print("=" * 70)
