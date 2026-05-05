# ============================================================
# Zyrix FinSuite — Stage 8 Phase B
# Sub-step 1: PlanName enum diagnostic
# Read-only. Does not modify any file.
# ============================================================

from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"

print("=" * 70)
print("ZYRIX FINSUITE — PlanName ENUM DIAGNOSTIC")
print("=" * 70)
print()

# ----- Existence check -----
if not SCHEMA.exists():
    print("[FAIL] schema.prisma not found at:")
    print("       " + str(SCHEMA))
    print("[ABORT] Cannot proceed without the schema file.")
    raise SystemExit(1)

text = SCHEMA.read_text(encoding="utf-8")
total_lines = text.count("\n") + 1
total_bytes = SCHEMA.stat().st_size

print("[OK] Schema located")
print("     Path:  " + str(SCHEMA))
print("     Size:  " + str(total_bytes) + " bytes")
print("     Lines: " + str(total_lines))
print()

# ----- Locate the PlanName enum block -----
print("-" * 70)
print("1. CURRENT PlanName ENUM DEFINITION")
print("-" * 70)

enum_match = re.search(
    r"enum\s+PlanName\s*\{([^}]*)\}",
    text,
    flags=re.DOTALL,
)

if not enum_match:
    print("[FAIL] PlanName enum NOT FOUND in schema.prisma")
    print("       This is unexpected. Stop and inspect manually.")
    raise SystemExit(1)

enum_body = enum_match.group(1)
enum_full = enum_match.group(0)

# Find line number of the enum
before = text[: enum_match.start()]
enum_start_line = before.count("\n") + 1
enum_end_line   = enum_start_line + enum_full.count("\n")

print("[OK] PlanName enum found")
print("     Lines: " + str(enum_start_line) + " to " + str(enum_end_line))
print()
print("     Raw block:")
print("     " + "-" * 60)
for raw in enum_full.splitlines():
    print("     " + raw)
print("     " + "-" * 60)
print()

# ----- Extract individual enum values -----
values = []
for raw in enum_body.splitlines():
    stripped = raw.strip()
    if not stripped:
        continue
    if stripped.startswith("//"):
        continue
    # An enum value is the leading identifier
    m = re.match(r"([A-Z_][A-Z0-9_]*)", stripped)
    if m:
        values.append(m.group(1))

print("[OK] Parsed enum values: " + str(len(values)))
for v in values:
    print("     - " + v)
print()

expected_old = {"STARTER", "BUSINESS", "PRO", "ENTERPRISE"}
expected_new = {"E_DONUSUM", "ON_MUHASEBE"}
present_set  = set(values)

print("-" * 70)
print("2. ENUM STATE CHECK")
print("-" * 70)
print("     STARTER present:      " + str("STARTER"     in present_set))
print("     BUSINESS present:     " + str("BUSINESS"    in present_set))
print("     PRO present:          " + str("PRO"         in present_set))
print("     ENTERPRISE present:   " + str("ENTERPRISE"  in present_set))
print("     E_DONUSUM present:    " + str("E_DONUSUM"   in present_set))
print("     ON_MUHASEBE present:  " + str("ON_MUHASEBE" in present_set))
print()

migration_state = "UNKNOWN"
if expected_new.issubset(present_set) and {"STARTER", "BUSINESS"}.issubset(present_set):
    migration_state = "ALREADY_MIGRATED_BOTH_PRESENT"
elif expected_new.issubset(present_set) and not ({"STARTER", "BUSINESS"} & present_set):
    migration_state = "ALREADY_MIGRATED_OLD_REMOVED"
elif not (expected_new & present_set) and {"STARTER", "BUSINESS"}.issubset(present_set):
    migration_state = "NOT_MIGRATED_ORIGINAL_STATE"
else:
    migration_state = "PARTIAL_OR_CUSTOM_STATE"

print("     => Migration state:  " + migration_state)
print()

# ----- Find all fields/models that reference PlanName -----
print("-" * 70)
print("3. MODELS REFERENCING PlanName")
print("-" * 70)

# Match a model block: model XYZ { ... }
model_blocks = re.findall(
    r"model\s+(\w+)\s*\{([^}]*)\}",
    text,
    flags=re.DOTALL,
)

usage_rows = []
for model_name, body in model_blocks:
    for raw in body.splitlines():
        if "PlanName" in raw:
            usage_rows.append((model_name, raw.strip()))

if usage_rows:
    print("[OK] PlanName is referenced in " + str(len(usage_rows)) + " field(s):")
    for model_name, raw in usage_rows:
        print("     - model " + model_name + " :: " + raw)
else:
    print("[WARN] No model fields reference PlanName.")
    print("       Either the enum is unused or the regex missed something.")
print()

# ----- Default values check -----
print("-" * 70)
print("4. @default() VALUES ON PlanName FIELDS")
print("-" * 70)

defaults_found = []
for model_name, raw in usage_rows:
    m = re.search(r"@default\(([A-Z_][A-Z0-9_]*)\)", raw)
    if m:
        defaults_found.append((model_name, raw, m.group(1)))

if defaults_found:
    for model_name, raw, val in defaults_found:
        print("     - " + model_name + " has @default(" + val + ")")
        if val in {"STARTER", "BUSINESS"}:
            print("       [NOTE] This default uses an OLD value — must be updated post-migration.")
else:
    print("     No @default() values detected on PlanName fields.")
print()

# ----- Raw occurrence counts (sanity check) -----
print("-" * 70)
print("5. RAW OCCURRENCE COUNTS IN schema.prisma")
print("-" * 70)
print("     'STARTER'      occurrences: " + str(text.count("STARTER")))
print("     'BUSINESS'     occurrences: " + str(text.count("BUSINESS")))
print("     'PRO'          occurrences: " + str(text.count("PRO")))
print("     'ENTERPRISE'   occurrences: " + str(text.count("ENTERPRISE")))
print("     'E_DONUSUM'    occurrences: " + str(text.count("E_DONUSUM")))
print("     'ON_MUHASEBE'  occurrences: " + str(text.count("ON_MUHASEBE")))
print()

# ----- Models we care about for provisioning -----
print("-" * 70)
print("6. PROVISIONING-RELATED MODELS PRESENCE")
print("-" * 70)
required_models = ["Merchant", "Subscription", "FeatureFlag", "AuditLog", "OtpCode"]
present_models = {name for name, _ in model_blocks}
for m in required_models:
    print("     " + m.ljust(15) + " -> " + ("PRESENT" if m in present_models else "MISSING"))
print()

# ----- Summary verdict -----
print("=" * 70)
print("DIAGNOSTIC SUMMARY")
print("=" * 70)
print("     File:                " + str(SCHEMA.name))
print("     Migration state:     " + migration_state)
print("     PlanName values:     " + ", ".join(values))
print("     Models using enum:   " + str(len(usage_rows)))
print("     Required models:     " + (
    "all present"
    if all(m in present_models for m in required_models)
    else "SOME MISSING (see section 6)"
))
print()
print("[DONE] Diagnostic complete. No files modified.")
print("       Send the entire output above back to Claude.")
print("=" * 70)