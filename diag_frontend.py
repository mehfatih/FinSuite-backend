from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite")
TARGET = ROOT / "src" / "utils" / "planCatalog.js"

print("=" * 70)
print("DIAGNOSE frontend planCatalog.js")
print("=" * 70)

if not TARGET.exists():
    print("[FAIL] File not found: " + str(TARGET))
    raise SystemExit(1)

text = TARGET.read_text(encoding="utf-8")
total_lines = text.count("\n") + 1
print()
print("Path:        " + str(TARGET))
print("Size:        " + str(TARGET.stat().st_size) + " bytes")
print("Total lines: " + str(total_lines))
print()

# Find activatePlan function
print("-" * 70)
print("activatePlan function (current implementation):")
print("-" * 70)
lines = text.splitlines()
in_fn = False
brace_count = 0
fn_start_line = None
fn_end_line = None
for n, line in enumerate(lines, 1):
    if not in_fn and ("function activatePlan" in line or "activatePlan =" in line or "activatePlan:" in line):
        in_fn = True
        fn_start_line = n
        brace_count = line.count("{") - line.count("}")
        print("L" + str(n).rjust(4) + ": " + line)
        if brace_count == 0 and ("=>" in line or "function" in line):
            continue
        continue
    if in_fn:
        print("L" + str(n).rjust(4) + ": " + line)
        brace_count += line.count("{") - line.count("}")
        if brace_count <= 0 and "{" in "".join(lines[fn_start_line-1:n]):
            fn_end_line = n
            break

print()
if fn_start_line:
    print("[OK] activatePlan found at lines " + str(fn_start_line) + "-" + str(fn_end_line))
else:
    print("[WARN] activatePlan not found by simple scan")

print()
print("-" * 70)
print("Last 25 lines:")
print("-" * 70)
last_lines = lines[-25:]
for n, line in enumerate(last_lines, total_lines - len(last_lines) + 1):
    print("L" + str(n).rjust(4) + ": " + line)

print()
print("=" * 70)
print("[DONE]")
print("=" * 70)