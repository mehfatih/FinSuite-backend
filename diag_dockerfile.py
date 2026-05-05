from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

# Look for Dockerfile
docker_paths = [
    ROOT / "Dockerfile",
    ROOT / "dockerfile",
    ROOT / "railway.toml",
    ROOT / "nixpacks.toml",
]

print("=" * 70)
print("DOCKERFILE / RAILWAY CONFIG DIAGNOSTIC")
print("=" * 70)
print()

for p in docker_paths:
    print("File: " + p.name)
    print("  Exists: " + str(p.exists()))
    if p.exists():
        print("  Size: " + str(p.stat().st_size) + " bytes")
        print("  Content:")
        print("  " + "-" * 60)
        text = p.read_text(encoding="utf-8")
        for n, line in enumerate(text.splitlines(), 1):
            print("  L" + str(n).rjust(3) + ": " + line)
        print()

# Check for puppeteer / chromium usage in code
print("=" * 70)
print("CHROMIUM / PUPPETEER USAGE IN CODE")
print("=" * 70)

src = ROOT / "src"
hits = []
for f in src.rglob("*.ts"):
    try:
        text = f.read_text(encoding="utf-8")
        if "puppeteer" in text.lower() or "chromium" in text.lower():
            hits.append((f.relative_to(ROOT), text.count("puppeteer"), text.count("chromium")))
    except Exception:
        pass

print()
if hits:
    print("Files mentioning puppeteer/chromium:")
    for path, p_count, c_count in hits:
        print("  " + str(path) + " - puppeteer:" + str(p_count) + " chromium:" + str(c_count))
else:
    print("[OK] No source files use puppeteer or chromium")

# Check package.json
pkg = ROOT / "package.json"
if pkg.exists():
    text = pkg.read_text(encoding="utf-8")
    print()
    print("package.json puppeteer/chromium:")
    print("  puppeteer:        " + str("puppeteer" in text and "puppeteer-core" not in text.replace("puppeteer-core", "")))
    print("  puppeteer-core:   " + str("puppeteer-core" in text))
    print("  chromium:         " + str("chromium" in text))

print()
print("=" * 70)
