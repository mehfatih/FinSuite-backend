from pathlib import Path

F = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\services\cashCrisisService.ts")
text = F.read_text(encoding="utf-8")
original = text

# Replace `salary: true` with `grossSalary: true`
text = text.replace("salary: true", "grossSalary: true")
# Replace `(p as any).salary` with `(p as any).grossSalary`
text = text.replace("(p as any).salary", "(p as any).grossSalary")

if text != original:
    F.write_text(text, encoding="utf-8")
    print("[OK] Replaced salary -> grossSalary")
else:
    print("[INFO] No changes")
