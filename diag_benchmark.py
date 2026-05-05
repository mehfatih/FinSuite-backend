from pathlib import Path

F = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\controllers\benchmarkController.ts")
text = F.read_text(encoding="utf-8")
lines = text.splitlines()

print("Lines 80-90 of benchmarkController.ts:")
for n in range(79, min(90, len(lines))):
    print("L" + str(n + 1).rjust(3) + ": " + lines[n].rstrip())
