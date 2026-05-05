from pathlib import Path

INDEX = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\index.ts")
text = INDEX.read_text(encoding="utf-8")

print("=" * 70)
print("VERIFY index.ts wiring")
print("=" * 70)
print()

print("/api/whatsapp present: " + str("/api/whatsapp" in text))
print("/api/banks present:    " + str("/api/banks" in text))
print()
print("Lines mentioning whatsapp/banks:")
for n, line in enumerate(text.splitlines(), 1):
    if "whatsapp" in line.lower() or "banks" in line.lower():
        print("  L" + str(n).rjust(3) + ": " + line.rstrip())
