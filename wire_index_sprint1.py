from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
INDEX = ROOT / "src" / "index.ts"
BACKUP = ROOT / "src" / "index.ts.backup-sprint1-1A"

print("=" * 70)
print("WIRE eIrsaliye routes into src/index.ts")
print("=" * 70)

shutil.copy2(INDEX, BACKUP)
print("[OK] Backup: " + BACKUP.name)
print()

text = INDEX.read_text(encoding="utf-8")
original = text

# Idempotency check
if 'from "./routes/eIrsaliye"' in text:
    print("[WARN] eIrsaliye route already wired")

# Find existing route imports
import_lines = re.findall(r'^import\s+\w+\s+from\s+"\./routes/[^"]+";?$', text, flags=re.MULTILINE)
use_lines = re.findall(r'^app\.use\("/api/[^"]+",\s*\w+\);?$', text, flags=re.MULTILINE)

print("Existing route imports: " + str(len(import_lines)))
print("Existing app.use calls: " + str(len(use_lines)))
print()

new_import = 'import eIrsaliyeRoutes from "./routes/eIrsaliye";'
new_use = 'app.use("/api/eirsaliye", eIrsaliyeRoutes);'

if new_import not in text:
    if not import_lines:
        print("[FAIL] No existing route imports found")
        raise SystemExit(1)
    last_import = import_lines[-1]
    text = text.replace(last_import, last_import + "\n" + new_import, 1)
    print("[OK] Inserted import after: " + last_import)

if new_use not in text:
    if not use_lines:
        print("[FAIL] No existing app.use found")
        raise SystemExit(1)
    last_use = use_lines[-1]
    text = text.replace(last_use, last_use + "\n" + new_use, 1)
    print("[OK] Inserted route registration")

# Update version string + counters
old_version = '`\\n\xf0\x9f\x9a\x80 Zyrix FinSuite v3.1 \xe2\x80\x94 port ${env.port}`'.encode("latin-1").decode("utf-8")
# That string is fragile across encodings; let's just match by signature
text = text.replace("Zyrix FinSuite v3.1", "Zyrix FinSuite v3.2", 1)
text = text.replace("16 features | 26 routes", "17 features | 27 routes", 1)

if text != original:
    INDEX.write_text(text, encoding="utf-8")
    print("[OK] index.ts updated")
    print("     New size: " + str(INDEX.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = INDEX.read_text(encoding="utf-8")
print("     eIrsaliyeRoutes import:    " + str(new_import in final))
print("     /api/eirsaliye registered: " + str(new_use in final))
print("     Version v3.2:              " + str("v3.2" in final))
print("     17 features | 27 routes:   " + str("17 features | 27 routes" in final))
print()
print("=" * 70)
