from pathlib import Path
import json
import shutil

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
TSCONFIG = ROOT / "tsconfig.json"

print("=" * 70)
print("Track B Step 1: tsconfig.json flags")
print("=" * 70)

if not TSCONFIG.exists():
    print("[FAIL] tsconfig.json not found")
    raise SystemExit(1)

shutil.copy2(TSCONFIG, TSCONFIG.with_suffix(".json.backup-track-b"))

# Read raw text first to show current state
print()
print("Current tsconfig.json:")
print("-" * 70)
print(TSCONFIG.read_text(encoding="utf-8"))
