print("=" * 70)
print("Generic Marketplace Framework - SQL Migration (20 providers)")
print("=" * 70)
print()
print("Run on Railway > FinSuite Postgres > Data > Query")
print()

print("-" * 70)
print("SECTION 1: Enums (20 providers + 3 status enums)")
print("-" * 70)
print("""
CREATE TYPE \"MarketplaceProvider\" AS ENUM (
  'TRENDYOL', 'HEPSIBURADA', 'N11', 'CICEKSEPETI', 'PTTAVM',
  'AMAZON_TR', 'GETIR', 'FLO', 'YEMEKSEPETI', 'VATAN',
  'SALLA', 'ZID', 'NOON_SA', 'AMAZON_SA', 'JARIR',
  'AMAZON_AE', 'NOON_AE', 'NAMSHI', 'CARREFOUR_AE', 'MUMZWORLD'
);

CREATE TYPE \"MarketplaceConnectionStatus\" AS ENUM (
  'PENDING', 'CONNECTED', 'EXPIRED', 'ERROR'
);

CREATE TYPE \"MarketplaceOrderStatus\" AS ENUM (
  'PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'
);

CREATE TYPE \"MarketplaceSettlementStatus\" AS ENUM (
  'PENDING', 'PAID', 'RECONCILED', 'DISCREPANCY'
);
""")

print()
print("-" * 70)
print("SECTION 2: marketplace_connections")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"marketplace_connections\" (
  \"id\"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"     TEXT NOT NULL,
  \"provider\"       \"MarketplaceProvider\" NOT NULL,
  \"sellerId\"       TEXT,
  \"apiKey\"         TEXT,
  \"apiSecret\"      TEXT,
  \"storeName\"      TEXT,
  \"region\"         TEXT,
  \"status\"         \"MarketplaceConnectionStatus\" NOT NULL DEFAULT 'PENDING',
  \"lastSyncAt\"     TIMESTAMP(3),
  \"lastSyncError\"  TEXT,
  \"createdAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"marketplace_connections_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"marketplace_connections_unique\"
  ON \"marketplace_connections\"(\"merchantId\", \"provider\");

CREATE INDEX IF NOT EXISTS \"marketplace_connections_provider_idx\"
  ON \"marketplace_connections\"(\"provider\");

CREATE INDEX IF NOT EXISTS \"marketplace_connections_status_idx\"
  ON \"marketplace_connections\"(\"status\");
""")

print()
print("-" * 70)
print("SECTION 3: marketplace_orders")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"marketplace_orders\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"connectionId\"     TEXT NOT NULL,
  \"provider\"         \"MarketplaceProvider\" NOT NULL,
  \"externalOrderId\"  TEXT NOT NULL,
  \"orderNumber\"      TEXT NOT NULL,
  \"status\"           \"MarketplaceOrderStatus\" NOT NULL,
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
  CONSTRAINT \"marketplace_orders_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE,
  CONSTRAINT \"marketplace_orders_connectionId_fkey\"
    FOREIGN KEY (\"connectionId\") REFERENCES \"marketplace_connections\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"marketplace_orders_unique\"
  ON \"marketplace_orders\"(\"connectionId\", \"externalOrderId\");

CREATE INDEX IF NOT EXISTS \"marketplace_orders_merchantId_idx\"
  ON \"marketplace_orders\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"marketplace_orders_provider_idx\"
  ON \"marketplace_orders\"(\"provider\");

CREATE INDEX IF NOT EXISTS \"marketplace_orders_status_idx\"
  ON \"marketplace_orders\"(\"status\");

CREATE INDEX IF NOT EXISTS \"marketplace_orders_date_idx\"
  ON \"marketplace_orders\"(\"orderDate\" DESC);

CREATE INDEX IF NOT EXISTS \"marketplace_orders_matched_idx\"
  ON \"marketplace_orders\"(\"matchedTxnId\");
""")

print()
print("-" * 70)
print("SECTION 4: marketplace_settlements")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"marketplace_settlements\" (
  \"id\"                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"            TEXT NOT NULL,
  \"connectionId\"          TEXT NOT NULL,
  \"provider\"              \"MarketplaceProvider\" NOT NULL,
  \"externalSettlementId\"  TEXT NOT NULL,
  \"periodStart\"           TIMESTAMP(3) NOT NULL,
  \"periodEnd\"             TIMESTAMP(3) NOT NULL,
  \"grossSales\"            DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalCommission\"       DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalShipping\"         DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"totalReturns\"          DECIMAL(18, 2) NOT NULL DEFAULT 0,
  \"netPayout\"             DECIMAL(18, 2) NOT NULL,
  \"currency\"              TEXT NOT NULL DEFAULT 'TRY',
  \"status\"                \"MarketplaceSettlementStatus\" NOT NULL DEFAULT 'PENDING',
  \"expectedPayoutDate\"    TIMESTAMP(3),
  \"actualPayoutDate\"      TIMESTAMP(3),
  \"matchedTxnId\"          TEXT,
  \"discrepancy\"           DECIMAL(18, 2),
  \"orderCount\"            INTEGER NOT NULL DEFAULT 0,
  \"providerData\"          JSONB,
  \"createdAt\"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"marketplace_settlements_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE,
  CONSTRAINT \"marketplace_settlements_connectionId_fkey\"
    FOREIGN KEY (\"connectionId\") REFERENCES \"marketplace_connections\"(\"id\") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS \"marketplace_settlements_unique\"
  ON \"marketplace_settlements\"(\"connectionId\", \"externalSettlementId\");

CREATE INDEX IF NOT EXISTS \"marketplace_settlements_merchantId_idx\"
  ON \"marketplace_settlements\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"marketplace_settlements_provider_idx\"
  ON \"marketplace_settlements\"(\"provider\");

CREATE INDEX IF NOT EXISTS \"marketplace_settlements_status_idx\"
  ON \"marketplace_settlements\"(\"status\");

CREATE INDEX IF NOT EXISTS \"marketplace_settlements_period_idx\"
  ON \"marketplace_settlements\"(\"periodStart\" DESC);
""")
print()
print("=" * 70)
