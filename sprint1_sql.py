print("=" * 70)
print("SQL MIGRATION - Sprint 1 Phase 1A")
print("Run on Railway > FinSuite Postgres > Data > Query")
print("=" * 70)
print()
print("Run each SECTION separately (Postgres needs ALTER TYPE / CREATE TYPE")
print("to commit before they can be used).")
print()

print("-" * 70)
print("SECTION 1: Create new enum types")
print("-" * 70)
print("""
CREATE TYPE \"EIrsaliyeStatus\" AS ENUM (
  'DRAFT',
  'READY_TO_SEND',
  'QUEUED',
  'SENT_PENDING_GIB',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE \"ReceiptScanStatus\" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PARSED',
  'FAILED',
  'CONVERTED'
);
""")
print()

print("-" * 70)
print("SECTION 2: Create e_irsaliyeler table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"e_irsaliyeler\" (
  \"id\"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"     TEXT NOT NULL,
  \"irsaliyeNo\"     TEXT NOT NULL,
  \"irsaliyeType\"   TEXT NOT NULL DEFAULT 'SEVK',
  \"status\"         \"EIrsaliyeStatus\" NOT NULL DEFAULT 'DRAFT',
  \"gibUUID\"        TEXT,
  \"gibResponse\"    JSONB,
  \"xmlContent\"     TEXT,
  \"pdfUrl\"         TEXT,
  \"buyerVkn\"       TEXT,
  \"buyerTitle\"     TEXT,
  \"buyerAddress\"   TEXT,
  \"deliveryAddress\" TEXT,
  \"deliveryDate\"   TIMESTAMP(3),
  \"vehiclePlate\"   TEXT,
  \"driverName\"     TEXT,
  \"driverTcKimlik\" TEXT,
  \"items\"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  \"totalAmount\"    DECIMAL(18,2) NOT NULL DEFAULT 0,
  \"currency\"       TEXT NOT NULL DEFAULT 'TRY',
  \"notes\"          TEXT,
  \"queuedAt\"       TIMESTAMP(3),
  \"sentAt\"         TIMESTAMP(3),
  \"acceptedAt\"     TIMESTAMP(3),
  \"rejectedAt\"     TIMESTAMP(3),
  \"rejectionReason\" TEXT,
  \"createdAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"e_irsaliyeler_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"e_irsaliyeler_irsaliyeNo_key\"
  ON \"e_irsaliyeler\"(\"irsaliyeNo\");

CREATE INDEX IF NOT EXISTS \"e_irsaliyeler_merchantId_idx\"
  ON \"e_irsaliyeler\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"e_irsaliyeler_status_idx\"
  ON \"e_irsaliyeler\"(\"status\");
""")
print()

print("-" * 70)
print("SECTION 3: Create receipt_scans table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"receipt_scans\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"imageUrl\"         TEXT,
  \"imageBase64\"      TEXT,
  \"status\"           \"ReceiptScanStatus\" NOT NULL DEFAULT 'PENDING',
  \"parsedVendor\"     TEXT,
  \"parsedAmount\"     DECIMAL(18,2),
  \"parsedCurrency\"   TEXT DEFAULT 'TRY',
  \"parsedDate\"       TIMESTAMP(3),
  \"parsedCategory\"   TEXT,
  \"parsedDescription\" TEXT,
  \"parsedTaxAmount\"  DECIMAL(18,2),
  \"parsedTaxRate\"    DECIMAL(5,2),
  \"parsedRawJson\"    JSONB,
  \"failureReason\"    TEXT,
  \"convertedExpenseId\" TEXT,
  \"createdAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"receipt_scans_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"receipt_scans_merchantId_idx\"
  ON \"receipt_scans\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"receipt_scans_status_idx\"
  ON \"receipt_scans\"(\"status\");
""")
print()

print("-" * 70)
print("SECTION 4: Verification")
print("-" * 70)
print("""
-- Check enums
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EIrsaliyeStatus')
ORDER BY enumsortorder;

SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ReceiptScanStatus')
ORDER BY enumsortorder;

-- Check tables
SELECT tablename FROM pg_tables WHERE tablename IN ('e_irsaliyeler', 'receipt_scans');

-- Should show: e_irsaliyeler, receipt_scans
""")
print()
print("=" * 70)
