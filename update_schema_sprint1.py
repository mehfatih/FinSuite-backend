# ============================================================
# Sprint 1 Phase 1A - Update prisma/schema.prisma locally
# - Add EIrsaliyeStatus + ReceiptScanStatus enums
# - Add EIrsaliye + ReceiptScan models
# - Add 2 relations to Merchant
# ============================================================

from pathlib import Path
import shutil

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")
SCHEMA = ROOT / "prisma" / "schema.prisma"
BACKUP = ROOT / "prisma" / "schema.prisma.backup-sprint1-1A"

print("=" * 70)
print("UPDATE schema.prisma - Sprint 1 Phase 1A")
print("=" * 70)

shutil.copy2(SCHEMA, BACKUP)
print("[OK] Backup: " + BACKUP.name + " (" + str(BACKUP.stat().st_size) + " bytes)")
print()

text = SCHEMA.read_text(encoding="utf-8")

# ---- 1. Add new enums after EFaturaStatus ----
old_enum_anchor = """enum EFaturaStatus {
  PENDING
  SENT
  ACCEPTED
  REJECTED
  CANCELLED
}"""

new_enum_anchor = """enum EFaturaStatus {
  PENDING
  SENT
  ACCEPTED
  REJECTED
  CANCELLED
}

enum EIrsaliyeStatus {
  DRAFT
  READY_TO_SEND
  QUEUED
  SENT_PENDING_GIB
  ACCEPTED
  REJECTED
  CANCELLED
}

enum ReceiptScanStatus {
  PENDING
  PROCESSING
  PARSED
  FAILED
  CONVERTED
}"""

if old_enum_anchor in text:
    text = text.replace(old_enum_anchor, new_enum_anchor, 1)
    print("[OK] Added EIrsaliyeStatus + ReceiptScanStatus enums")
else:
    print("[FAIL] EFaturaStatus enum not found")
    raise SystemExit(1)

# ---- 2. Add EIrsaliye + ReceiptScan models AFTER EFatura model ----
# Locate the @@map("e_faturalar") closing line of EFatura
import re
efatura_match = re.search(
    r'(model EFatura \{[^}]*?@@map\("e_faturalar"\)\n\})',
    text,
    flags=re.DOTALL,
)

if not efatura_match:
    print("[FAIL] EFatura model block not found with @@map anchor")
    raise SystemExit(1)

efatura_block = efatura_match.group(1)

new_models = '''

model EIrsaliye {
  id              String          @id @default(uuid())
  merchantId      String
  irsaliyeNo      String          @unique
  irsaliyeType    String          @default("SEVK")
  status          EIrsaliyeStatus @default(DRAFT)
  gibUUID         String?
  gibResponse     Json?
  xmlContent      String?
  pdfUrl          String?
  buyerVkn        String?
  buyerTitle      String?
  buyerAddress    String?
  deliveryAddress String?
  deliveryDate    DateTime?
  vehiclePlate    String?
  driverName      String?
  driverTcKimlik  String?
  items           Json            @default("[]")
  totalAmount     Decimal         @default(0) @db.Decimal(18, 2)
  currency        String          @default("TRY")
  notes           String?
  queuedAt        DateTime?
  sentAt          DateTime?
  acceptedAt      DateTime?
  rejectedAt      DateTime?
  rejectionReason String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  merchant        Merchant        @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([status])
  @@map("e_irsaliyeler")
}

model ReceiptScan {
  id                  String            @id @default(uuid())
  merchantId          String
  imageUrl            String?
  imageBase64         String?
  status              ReceiptScanStatus @default(PENDING)
  parsedVendor        String?
  parsedAmount        Decimal?          @db.Decimal(18, 2)
  parsedCurrency      String?           @default("TRY")
  parsedDate          DateTime?
  parsedCategory      String?
  parsedDescription   String?
  parsedTaxAmount     Decimal?          @db.Decimal(18, 2)
  parsedTaxRate       Decimal?          @db.Decimal(5, 2)
  parsedRawJson       Json?
  failureReason       String?
  convertedExpenseId  String?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt
  merchant            Merchant          @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([status])
  @@map("receipt_scans")
}'''

text = text.replace(efatura_block, efatura_block + new_models, 1)
print("[OK] Added EIrsaliye + ReceiptScan models after EFatura")

# ---- 3. Add 2 relations to Merchant ----
old_merchant_relations = '''  eFaturalar        EFatura[]
  muhasebeciLinks   MuhasebeciLink[]'''

new_merchant_relations = '''  eFaturalar        EFatura[]
  eIrsaliyeler      EIrsaliye[]
  receiptScans      ReceiptScan[]
  muhasebeciLinks   MuhasebeciLink[]'''

if old_merchant_relations in text:
    text = text.replace(old_merchant_relations, new_merchant_relations, 1)
    print("[OK] Added eIrsaliyeler + receiptScans relations to Merchant")
else:
    print("[FAIL] Merchant relations anchor not found")
    raise SystemExit(1)

SCHEMA.write_text(text, encoding="utf-8")
print()
print("[OK] schema.prisma written")
print("     Old size: " + str(BACKUP.stat().st_size) + " bytes")
print("     New size: " + str(SCHEMA.stat().st_size) + " bytes")
print()

# Verification
print("-" * 70)
print("VERIFICATION")
print("-" * 70)
final = SCHEMA.read_text(encoding="utf-8")
checks = [
    ("EIrsaliyeStatus enum",       "enum EIrsaliyeStatus {" in final),
    ("ReceiptScanStatus enum",     "enum ReceiptScanStatus {" in final),
    ("EIrsaliye model",            "model EIrsaliye {" in final),
    ("ReceiptScan model",          "model ReceiptScan {" in final),
    ("EIrsaliye @@map",            '@@map("e_irsaliyeler")' in final),
    ("ReceiptScan @@map",          '@@map("receipt_scans")' in final),
    ("Merchant.eIrsaliyeler",      "eIrsaliyeler      EIrsaliye[]" in final),
    ("Merchant.receiptScans",      "receiptScans      ReceiptScan[]" in final),
    ("EIrsaliye 7 statuses",       "DRAFT" in final and "READY_TO_SEND" in final and "SENT_PENDING_GIB" in final),
    ("ReceiptScan 5 statuses",     "PROCESSING" in final and "PARSED" in final and "CONVERTED" in final),
]
for label, ok in checks:
    print("     " + label.ljust(28) + " -> " + ("OK" if ok else "MISSING"))
print()
print("=" * 70)
print("[DONE] Next: prisma db push --accept-data-loss")
print("=" * 70)
