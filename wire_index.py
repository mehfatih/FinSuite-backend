# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Step 7: Wire plans routes into src/index.ts
# ============================================================

from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
INDEX = ROOT / "src" / "index.ts"
BACKUP = ROOT / "src" / "index.ts.backup-stage-8B"

print("=" * 70)
print("WIRE plans routes into src/index.ts")
print("=" * 70)

if not INDEX.exists():
    print("[FAIL] index.ts not found")
    raise SystemExit(1)

# Backup
shutil.copy2(INDEX, BACKUP)
print("[OK] Backup created: " + BACKUP.name)
print("     Size: " + str(BACKUP.stat().st_size) + " bytes")
print()

text = INDEX.read_text(encoding="utf-8")
original = text

# ----- Diagnostic: show structure first -----
print("-" * 70)
print("DIAGNOSTIC: existing route registrations")
print("-" * 70)

# Find all existing route imports
import_lines = re.findall(r'^import\s+\w+\s+from\s+"\./routes/[^"]+";?$', text, flags=re.MULTILINE)
print("     Existing route imports: " + str(len(import_lines)))
for line in import_lines[:5]:
    print("     " + line)
if len(import_lines) > 5:
    print("     ... (" + str(len(import_lines) - 5) + " more)")
print()

# Find all app.use("/api/...") lines
use_lines = re.findall(r'^app\.use\("/api/[^"]+",\s*\w+\);?$', text, flags=re.MULTILINE)
print("     Existing route registrations: " + str(len(use_lines)))
for line in use_lines[:5]:
    print("     " + line)
if len(use_lines) > 5:
    print("     ... (" + str(len(use_lines) - 5) + " more)")
print()

# Idempotency: check if already wired
if 'from "./routes/plans"' in text:
    print("[WARN] plans routes appear to be already wired.")
    print("       Will skip the import insertion if already present.")
    print()

# ----- Insert import -----
new_import = 'import plansRoutes from "./routes/plans";'

if new_import in text:
    print("[OK] Import already present, skipping insertion")
else:
    if not import_lines:
        print("[FAIL] No existing route imports found - cannot determine insertion point")
        raise SystemExit(1)
    last_import = import_lines[-1]
    text = text.replace(last_import, last_import + "\n" + new_import, 1)
    print("[OK] Inserted import after: " + last_import)
print()

# ----- Insert app.use -----
new_use = 'app.use("/api/plans", plansRoutes);'

if new_use in text:
    print("[OK] Route registration already present, skipping")
else:
    if not use_lines:
        print("[FAIL] No existing app.use registrations found")
        raise SystemExit(1)
    last_use = use_lines[-1]
    text = text.replace(last_use, last_use + "\n" + new_use, 1)
    print("[OK] Inserted route registration after: " + last_use)
print()

# Write only if changed
if text != original:
    INDEX.write_text(text, encoding="utf-8")
    print("[OK] index.ts written")
    print("     New size: " + str(INDEX.stat().st_size) + " bytes")
else:
    print("[OK] No changes required")
print()

# ----- Verification -----
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = INDEX.read_text(encoding="utf-8")
print("     plansRoutes import present:  " + str(new_import in final))
print("     /api/plans registered:       " + str(new_use in final))
print()
print("=" * 70)
print("[DONE] index.ts wired. Send output to Claude.")
print("=" * 70)