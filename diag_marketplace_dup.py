from pathlib import Path
import re

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")

# Find all occurrences of "model MarketplaceOrder"
for m in re.finditer(r'model\s+(MarketplaceOrder|MarketplaceConnection|MarketplaceSettlement)\s*\{', text):
    line_num = text[:m.start()].count("\n") + 1
    print(f"Line {line_num}: {m.group(0)}")

print()
print("All `marketplaceOrders` occurrences in Merchant model:")
# find Merchant model block
mm = re.search(r'model\s+Merchant\s*\{(.*?)^\}', text, flags=re.DOTALL | re.MULTILINE)
if mm:
    block = mm.group(1)
    for line in block.splitlines():
        if "marketplaceOrders" in line.lower() or "marketplaceConnection" in line.lower() or "marketplaceSettlement" in line.lower():
            print("  " + line.rstrip())
