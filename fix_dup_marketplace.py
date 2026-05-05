from pathlib import Path
import re

SCHEMA = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend\prisma\schema.prisma")
text = SCHEMA.read_text(encoding="utf-8")
original = text

# Remove the OLD MarketplaceOrder model (line 1344 onwards) -- the one with `channel MarketplaceChannel`
old_marketplace_order = '''model MarketplaceOrder {
  id              String             @id @default(uuid())
  merchantId      String
  channel         MarketplaceChannel
  externalOrderId String
  customerName    String
  customerPhone   String?
  items           Json
  subtotal        Decimal            @db.Decimal(18, 2)
  commission      Decimal            @default(0) @db.Decimal(18, 2)
  shippingCost    Decimal            @default(0) @db.Decimal(18, 2)
  total           Decimal            @db.Decimal(18, 2)
  currency        String             @default("TRY")
  status          String             @default("NEW")
  orderDate       DateTime
  shipDate        DateTime?
  deliveryDate    DateTime?
  trackingNumber  String?
  invoiceId       String?
  syncedAt        DateTime           @default(now())
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt
  merchant        Merchant           @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@unique([merchantId, channel, externalOrderId])
  @@map("marketplace_orders")
}

model MarketplaceIntegration {
  id         String             @id @default(uuid())
  merchantId String
  channel    MarketplaceChannel
  apiKey     String?
  apiSecret  String?
  supplierId String?
  isActive   Boolean            @default(true)
  lastSyncAt DateTime?
  settings   Json               @default("{}")
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  @@unique([merchantId, channel])
  @@map("marketplace_integrations")
}

'''

if old_marketplace_order in text:
    text = text.replace(old_marketplace_order, "")
    print("[OK] Removed legacy MarketplaceOrder + MarketplaceIntegration models")

# Also remove any old `marketplaceOrders` line from Merchant model that refers to the OLD type
# We need to check if there's an old reference inside Merchant block.
# Find Merchant model
mm = re.search(r'(model\s+Merchant\s*\{)(.*?)(^\})', text, flags=re.DOTALL | re.MULTILINE)
if mm:
    merchant_block = mm.group(2)
    # Count how many `marketplaceOrders` lines exist
    count = merchant_block.count("marketplaceOrders")
    print(f"  Found {count} 'marketplaceOrders' references in Merchant block")
    if count > 1:
        # Remove duplicates: keep only the first one, or specifically the one without ` MarketplaceOrder[]`
        # Actually we want to keep `marketplaceOrders MarketplaceOrder[]` (lowercase ref) ONCE
        # Strategy: remove all and re-insert one
        new_block = re.sub(r'\s*marketplaceOrders\s+MarketplaceOrder\[\]\n', '\n', merchant_block)
        # Now add it back once before the closing
        # Find where other marketplace relations are
        if "marketplaceConnections" in new_block:
            new_block = new_block.replace(
                "marketplaceConnections  MarketplaceConnection[]",
                "marketplaceConnections  MarketplaceConnection[]\n  marketplaceOrders       MarketplaceOrder[]",
                1,
            )
        text = text.replace(merchant_block, new_block, 1)
        print("  [OK] Deduped marketplaceOrders in Merchant")

# Also remove MarketplaceChannel enum if not used anywhere else
mc_enum = re.search(r'enum\s+MarketplaceChannel\s*\{[^}]*\}\s*\n', text)
if mc_enum:
    # Check if it's still referenced
    if "MarketplaceChannel" not in text.replace(mc_enum.group(0), ""):
        text = text.replace(mc_enum.group(0), "")
        print("[OK] Removed unused MarketplaceChannel enum")

if text != original:
    SCHEMA.write_text(text, encoding="utf-8")
    print()
    print("Schema cleaned. Run: npx prisma format && npx prisma db push --accept-data-loss")
else:
    print("[INFO] No changes")
