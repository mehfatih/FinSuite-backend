print("=" * 70)
print("Trendyol Reconciliation - SQL Migration")
print("=" * 70)
print()
print("Run on Railway > FinSuite Postgres > Data > Query")
print()

print("-" * 70)
print("SECTION 1: New enums")
print("-" * 70)
print("""
CREATE TYPE \"TrendyolOrderStatus\" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED'
);

CREATE TYPE \"TrendyolSettlementStatus\" AS ENUM (
  'PENDING',
  'PAID',
  'RECONCILED',
  'DISCREPANCY'
);

CREATE TYPE \"TrendyolConnectionStatus\" AS ENUM (
  'PENDING',
  'CONNECTED',
  'EXPIRED',
  'ERROR'
);
""")

print()
print("-" * 70)
print("SECTION 2: trendyol_connections table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"trendyol_connections\" (
  \"id\"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"     TEXT NOT NULL UNIQUE,
  \"sellerId\"       TEXT,
  \"apiKey\"         TEXT,
  \"apiSecret\"      TEXT,
  \"storeName\"      TEXT,
  \"status\"         \"TrendyolConnectionStatus\" NOT NULL DEFAULT 'PENDING',
  \"lastSyncAt\"     TIMESTAMP(3),
  \"lastSyncError\"  TEXT,
  \"createdAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"trendyol_connections_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"trendyol_connections_status_idx\"
  ON \"trendyol_connections\"(\"status\");
""")

print()
print("-" * 70)
print("SECTION 3: trendyol_orders table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"trendyol_orders\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"connectionId\"     TEXT NOT NULL,
  \"trendyolOrderId\"  TEXT NOT NULL,
  \"orderNumber\"      TEXT NOT NULL,
  \"status\"           \"TrendyolOrderStatus\" NOT NULL,
  \"customerName\"     TEXT,
  \"productName\"      TEXT,
  \"quantity\"         INTEGER NOT NULL DEFAULT 1,
  \"grossAmount\"      DECIMAL(18, 2) NOT NULL,
  \"commission\"       DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"shippingCost\"     DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"netAmount\"        DECIMAL(18, 2) NOT NULL,
  \"currency\"         TEXT NOT NULL DEFAULT 'TRY',
  \"orderDate\"        TIMESTAMP(3) NOT NULL,
  \"shippedDate\"      TIMESTAMP(3),
  \"deliveredDate\"    TIMESTAMP(3),
  \"matchedTxnId\"     TEXT,
  \"providerData\"     JSONB,
  \"createdAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"trendyol_orders_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE,
  CONSTRAINT \"trendyol_orders_connectionId_fkey\"
    FOREIGN KEY (\"connectionId\") REFERENCES \"trendyol_connections\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"trendyol_orders_unique\"
  ON \"trendyol_orders\"(\"connectionId\", \"trendyolOrderId\");

CREATE INDEX IF NOT EXISTS \"trendyol_orders_merchantId_idx\"
  ON \"trendyol_orders\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"trendyol_orders_status_idx\"
  ON \"trendyol_orders\"(\"status\");

CREATE INDEX IF NOT EXISTS \"trendyol_orders_date_idx\"
  ON \"trendyol_orders\"(\"orderDate\" DESC);

CREATE INDEX IF NOT EXISTS \"trendyol_orders_matched_idx\"
  ON \"trendyol_orders\"(\"matchedTxnId\");
""")

print()
print("-" * 70)
print("SECTION 4: trendyol_settlements table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"trendyol_settlements\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"connectionId\"     TEXT NOT NULL,
  \"trendyolSettlementId\" TEXT NOT NULL,
  \"periodStart\"      TIMESTAMP(3) NOT NULL,
  \"periodEnd\"        TIMESTAMP(3) NOT NULL,
  \"grossSales\"       DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalCommission\"  DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalShipping\"    DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalReturns\"     DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"netPayout\"        DECIMAL(18, 2) NOT NULL,
  \"currency\"         TEXT NOT NULL DEFAULT 'TRY',
  \"status\"           \"TrendyolSettlementStatus\" NOT NULL DEFAULT 'PENDING',
  \"expectedPayoutDate\" TIMESTAMP(3),
  \"actualPayoutDate\" TIMESTAMP(3),
  \"matchedTxnId\"     TEXT,
  \"discrepancy\"      DECIMAL(18, 2),
  \"orderCount\"       INTEGER NOT NULL DEFAULT 0,
  \"providerData\"     JSONB,
  \"createdAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"trendyol_settlements_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE,
  CONSTRAINT \"trendyol_settlements_connectionId_fkey\"
    FOREIGN KEY (\"connectionId\") REFERENCES \"trendyol_connections\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"trendyol_settlements_unique\"
  ON \"trendyol_settlements\"(\"connectionId\", \"trendyolSettlementId\");

CREATE INDEX IF NOT EXISTS \"trendyol_settlements_merchantId_idx\"
  ON \"trendyol_settlements\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"trendyol_settlements_status_idx\"
  ON \"trendyol_settlements\"(\"status\");

CREATE INDEX IF NOT EXISTS \"trendyol_settlements_period_idx\"
  ON \"trendyol_settlements\"(\"periodStart\" DESC);
""")

print()
print("-" * 70)
print("SECTION 5: Verification")
print("-" * 70)
print("""
SELECT typname FROM pg_type
WHERE typname IN ('TrendyolOrderStatus', 'TrendyolSettlementStatus', 'TrendyolConnectionStatus')
ORDER BY typname;

SELECT tablename FROM pg_tables
WHERE tablename LIKE 'trendyol_%'
ORDER BY tablename;
""")
print()
print("=" * 70)
