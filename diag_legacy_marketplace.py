from pathlib import Path
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

# Search for usages of old MarketplaceOrder / MarketplaceIntegration / MarketplaceChannel
print("Searching for legacy marketplace usages...")
print()

for f in ROOT.rglob("*.ts"):
    if "node_modules" in str(f) or "dist" in str(f) or "backup" in str(f):
        continue
    try:
        content = f.read_text(encoding="utf-8")
    except:
        continue

    rel = str(f.relative_to(ROOT))
    matches = []
    if "MarketplaceChannel" in content:
        matches.append("MarketplaceChannel")
    if re.search(r'\bmarketplaceOrders\b', content):
        matches.append("marketplaceOrders (variable)")
    if "marketplaceIntegration" in content.lower() or "MarketplaceIntegration" in content:
        matches.append("MarketplaceIntegration")
    if "prisma.marketplaceOrder\\." in content:
        matches.append("prisma.marketplaceOrder.")

    if matches:
        print(f"{rel}: {matches}")
