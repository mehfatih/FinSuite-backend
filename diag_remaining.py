from pathlib import Path

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\controllers")

# Files we still need to inspect
inspect_lines = [
    ("campaignController.ts", [62, 109, 118, 136, 140, 162, 165]),
    ("customerScoreController.ts", [121, 169, 199]),
    ("installmentController.ts", [84, 87, 93, 97, 100]),
    ("invoicePdfController.ts", [14, 17]),
    ("marketplaceController.ts", [68, 108]),
    ("muhasebeciController.ts", [158, 179, 184, 213, 233]),
    ("paymentController.ts", [184, 189]),
    ("publicProfileController.ts", [70, 73]),
    ("teamController.ts", [114, 138, 143, 163, 167]),
    ("eFaturaController.ts", [101]),
    ("aiAssistantController.ts", [71]),
    ("benchmarkController.ts", [83, 84]),
    ("authController.ts", [123, 171]),
]

for fname, line_nums in inspect_lines:
    f = ROOT / fname
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    lines = text.splitlines()
    print()
    print("=" * 70)
    print(fname)
    print("=" * 70)
    for n in line_nums:
        if 0 < n <= len(lines):
            line = lines[n - 1]
            print(f"L{n}: {line.rstrip()[:140]}")
