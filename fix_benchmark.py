from pathlib import Path

F = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\src\controllers\benchmarkController.ts")
text = F.read_text(encoding="utf-8")
original = text

# Wrap `avg.X > 0` and `avg.X > something` patterns
text = text.replace("avg.avgRevenue > 0", "Number(avg.avgRevenue) > 0")
text = text.replace("avg.avgInvoiceValue > 0", "Number(avg.avgInvoiceValue) > 0")
# Also avg.avgDaysToPay used in subtraction (line 86 already passes since both sides numbers, but let's be safe)
text = text.replace("> avg.avgDaysToPay", "> Number(avg.avgDaysToPay)")
text = text.replace("- avg.avgDaysToPay", "- Number(avg.avgDaysToPay)")
text = text.replace("Number(avg.avgDaysToPay)Number(avg.avgDaysToPay)", "Number(avg.avgDaysToPay)")

if text != original:
    F.write_text(text, encoding="utf-8")
    print("[OK] Wrapped avg.* fields with Number()")
else:
    print("[INFO] No changes")
