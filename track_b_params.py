from pathlib import Path
import re
import shutil

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SRC = ROOT / "src"

print("=" * 70)
print("Track B: Bulk fix req.params type narrowing")
print("=" * 70)

# Step 1: Create a tiny helper file
HELPERS = SRC / "utils" / "params.ts"
HELPERS.parent.mkdir(exist_ok=True)
helper_content = '''// ============================================================
// Express request param narrowing helper
//
// Express types req.params values as string | string[].
// In practice they are always string in our codebase. This
// helper narrows the type cleanly so we don't have to litter
// the controllers with String() casts.
// ============================================================

export function pid(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
'''
HELPERS.write_text(helper_content, encoding="utf-8")
print("[OK] Created src/utils/params.ts")
print()

# Step 2: scan controller files and patch them
controllers_dir = SRC / "controllers"
files = list(controllers_dir.rglob("*.ts"))

# Key patterns to replace:
# req.params.id  -> pid(req.params.id)  (when used as a string value)
# req.params.X   -> pid(req.params.X)
#
# We will be conservative: only replace when the line ALREADY has a known
# error pattern (string | string[] complaint).
# Strategy: textual replace across known controller files of the patterns
# `: req.params.X` and `, req.params.X` and `(req.params.X)` and `= req.params.X`

# Files that had the error in the log
target_files = [
    "admin/adminMerchantsController.ts",
    "aiController.ts",
    "campaignController.ts",
    "checkController.ts",
    "customerController.ts",
    "customerScoreController.ts",
    "dealController.ts",
    "eFaturaController.ts",
    "factoringController.ts",
    "installmentController.ts",
    "invoiceController.ts",
    "invoicePdfController.ts",
    "marketplaceController.ts",
    "muhasebeciController.ts",
    "notificationController.ts",
    "personnelController.ts",
    "publicProfileController.ts",
    "recurringController.ts",
    "stockController.ts",
    "taskController.ts",
    "taxCalendarController.ts",
    "teamController.ts",
]

total_patched = 0

for rel in target_files:
    f = controllers_dir / rel
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    original = text

    # Add the import if file uses req.params and import not present
    if "req.params" not in text:
        continue

    # Compute relative path for import
    depth = len(Path(rel).parts) - 1
    import_path = ("../" * depth) + "../utils/params"
    import_line = 'import { pid } from "' + import_path + '";'

    if import_line not in text and "from \"../utils/params\"" not in text and "from \"../../utils/params\"" not in text:
        # Insert after first import line
        m = re.search(r'^(import\s+[^;]+;)', text, flags=re.MULTILINE)
        if m:
            text = text.replace(m.group(1), m.group(1) + "\n" + import_line, 1)

    # Now replace req.params.X with pid(req.params.X) in contexts where
    # bare access is used as a string. We DON'T want to wrap if it's
    # already wrapped or inside a String() cast.
    #
    # We replace in these safe patterns:
    #   = req.params.X   ->   = pid(req.params.X)
    #   ( req.params.X   ->   ( pid(req.params.X)    (but not in pid() itself)
    #   , req.params.X   ->   , pid(req.params.X)
    #   : req.params.X   ->   : pid(req.params.X)
    #   { id: req.params.X  ->  { id: pid(req.params.X)

    # Use a regex that matches `req.params.<word>` not preceded by `(` (already inside a call) or by 'String'.
    # Replace only standalone identifiers.
    def replace_param(m):
        full = m.group(0)
        return "pid(" + full + ")"

    # Pattern: `req.params.<word>` not already wrapped in pid(
    new_text = re.sub(
        r'(?<!pid\()\breq\.params\.\w+\b',
        replace_param,
        text,
    )

    # But wait: this would double-wrap things like req.params.id.toString().
    # Let's revert if the next char is `.` (method call) - we don't want to wrap those.
    # Better: only wrap when followed by space, comma, ), ], }, ;, or end-of-line.
    # Re-do more carefully:
    new_text = text
    new_text = re.sub(
        r'(?<!pid\()\breq\.params\.(\w+)(?=[\s,);\]}|=]|$)',
        r'pid(req.params.\1)',
        new_text,
    )

    if new_text != original:
        f.write_text(new_text, encoding="utf-8")
        diff = new_text.count("pid(req.params.") - original.count("pid(req.params.")
        if diff > 0:
            print(f"[OK] {rel}: wrapped {diff} occurrences")
            total_patched += diff

print()
print("=" * 70)
print(f"Total occurrences wrapped: {total_patched}")
print("=" * 70)
