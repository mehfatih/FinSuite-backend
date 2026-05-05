from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("DIAGNOSE publicAiDemo issue")
print("=" * 70)
print()

# 1. Check if file exists locally
target = ROOT / "src" / "routes" / "publicAiDemo.ts"
print("File exists locally:    " + str(target.exists()))
if target.exists():
    print("File size:              " + str(target.stat().st_size) + " bytes")
print()

# 2. Show import + route lines from index.ts
index = ROOT / "src" / "index.ts"
text = index.read_text(encoding="utf-8")
print("Lines in index.ts referencing publicAiDemo:")
for n, line in enumerate(text.splitlines(), 1):
    if "publicAiDemo" in line.lower() or "publicaidemo" in line.lower() or "PublicAiDemo" in line:
        print("     L" + str(n) + ": " + line.strip())
print()

# 3. Show controller file if it exists
controller_candidates = list((ROOT / "src" / "controllers").glob("*[Pp]ublic*[Aa][Ii]*"))
print("Possible controller files:")
for c in controller_candidates:
    print("     - " + c.name + " (" + str(c.stat().st_size) + " bytes)")
if not controller_candidates:
    print("     (none found)")
print()

print("=" * 70)