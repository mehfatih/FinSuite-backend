from pathlib import Path
import re

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")

m = re.search(r'model\s+Personnel\s*\{([^}]*)\}', text, flags=re.DOTALL)
if m:
    print("Personnel model fields:")
    print(m.group(0))
