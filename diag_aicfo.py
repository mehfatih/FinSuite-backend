from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("DIAGNOSE for AI CFO Voice Assistant")
print("=" * 70)

# 1. Existing AI services patterns (reuse what works)
print()
print("[1] Existing AI service files:")
for f in (ROOT / "src" / "services").glob("*.ts"):
    name = f.name
    if "ai" in name.lower() or "gemini" in name.lower():
        size_kb = round(f.stat().st_size / 1024, 1)
        print("  " + name + " (" + str(size_kb) + " KB)")

# 2. Check for existing AI conversation models
print()
print("[2] Existing AI conversation models in schema:")
schema = (ROOT / "prisma" / "schema.prisma").read_text(encoding="utf-8")
ai_models = re.findall(r'model\s+(\w*[Aa][Ii]\w*|\w*[Cc]onversation\w*|\w*[Cc]hat\w*)\s*\{', schema)
for m in set(ai_models):
    print("  " + m)

# 3. Show AiConversation model
print()
print("[3] AiConversation model:")
m = re.search(r'model\s+AiConversation\s*\{([^}]*)\}', schema, flags=re.DOTALL)
if m:
    print(m.group(0))
else:
    print("  [not found]")

# 4. Show AiAssistantChat model
print()
print("[4] AiAssistantChat model:")
m = re.search(r'model\s+AiAssistantChat\s*\{([^}]*)\}', schema, flags=re.DOTALL)
if m:
    print(m.group(0))
else:
    print("  [not found]")

# 5. List all aggregate-able tables for AI context (revenue, expenses, etc.)
print()
print("[5] Tables Gemini can query for CFO context:")
useful = ["Invoice", "Expense", "BankTransaction", "PaymentLink", "Customer",
         "Deal", "TaxEvent", "Personnel", "StockItem", "Check", "Installment"]
for model in useful:
    if "model " + model + " {" in schema:
        print("  ✓ " + model)
    else:
        print("  ✗ " + model + " (not in schema)")
