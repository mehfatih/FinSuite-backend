from pathlib import Path

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")

# Replace @unique with named map
old = '  iban            String?               @unique'
new = '  iban            String?               @unique(map: "bank_connections_iban_key")'

if old in text:
    text = text.replace(old, new, 1)
    SCHEMA.write_text(text, encoding="utf-8")
    print("[OK] Renamed iban unique index to match DB")
else:
    print("[FAIL] Anchor not found")

# Verify
final = SCHEMA.read_text(encoding="utf-8")
print()
print("Verification:")
for line in final.splitlines():
    if "iban" in line.lower() and "@unique" in line:
        print("  " + line)
