from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
NIXPACKS = ROOT / "nixpacks.toml"

print("=" * 70)
print("CREATE nixpacks.toml to skip chromium apt install")
print("=" * 70)

content = '''# ============================================================
# Zyrix FinSuite Backend - Nixpacks override
#
# Goal: Cut deploy time from ~17min to ~2-3min by stopping
# Nixpacks from auto-installing chromium + 12 GUI libs via apt.
#
# puppeteer (used only by invoicePdfController.ts) ships its own
# chromium binary via npm during install - that takes ~30s instead
# of 17 minutes.
# ============================================================

[phases.setup]
nixPkgs = ["nodejs_20", "npm-9_x", "openssl"]
aptPkgs = []

[phases.install]
cmds = ["npm ci"]

[phases.build]
cmds = ["npm install && npx prisma generate"]

[start]
cmd = "npx tsx src/index.ts"

[variables]
# Tell puppeteer to download its own chromium (small, fast)
# instead of relying on a system package
PUPPETEER_SKIP_DOWNLOAD = "false"
'''

NIXPACKS.write_text(content, encoding="utf-8")
print("[OK] nixpacks.toml written")
print("     Size: " + str(NIXPACKS.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
written = NIXPACKS.read_text(encoding="utf-8")
checks = [
    ("aptPkgs is empty",        'aptPkgs = []' in written),
    ("nodejs_20 in nixPkgs",    "nodejs_20" in written),
    ("npm ci install command",  "npm ci" in written),
    ("prisma generate in build","prisma generate" in written),
    ("start command",           "tsx src/index.ts" in written),
    ("PUPPETEER_SKIP_DOWNLOAD", "PUPPETEER_SKIP_DOWNLOAD" in written),
]
for label, ok in checks:
    print("     " + label.ljust(30) + " -> " + ("OK" if ok else "MISSING"))
print()
print("=" * 70)
