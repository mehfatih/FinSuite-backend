from pathlib import Path

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")
lines = text.splitlines()

# Show lines 1340-1500 to see the duplicate block
print("Lines 1340-1500 (duplicate block area):")
for i in range(1339, min(1500, len(lines))):
    print(f"L{i+1}: {lines[i]}")
