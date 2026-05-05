print("=" * 70)
print("SQL MIGRATION - Phase 1B (WhatsApp + Banks)")
print("Run on Railway > FinSuite Postgres > Data > Query")
print("Each SECTION runs as ONE query.")
print("=" * 70)

print()
print("-" * 70)
print("SECTION 1: New enum types (run all together)")
print("-" * 70)
print("""
CREATE TYPE \"WhatsAppStatus\" AS ENUM (
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

CREATE TYPE \"BankProvider\" AS ENUM (
  'GARANTI',
  'IS_BANKASI',
  'YAPI_KREDI',
  'AKBANK',
  'ZIRAAT',
  'OTHER'
);

CREATE TYPE \"BankConnectionStatus\" AS ENUM (
  'PENDING',
  'CONNECTED',
  'EXPIRED',
  'REVOKED',
  'ERROR'
);

CREATE TYPE \"BankTxnDirection\" AS ENUM (
  'IN',
  'OUT'
);
""")

print()
print("-" * 70)
print("SECTION 2: whatsapp_messages table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"whatsapp_messages\" (
  \"id\"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"    TEXT NOT NULL,
  \"invoiceId\"     TEXT,
  \"recipientPhone\" TEXT NOT NULL,
  \"messageType\"   TEXT NOT NULL DEFAULT 'invoice',
  \"templateName\"  TEXT,
  \"bodyText\"      TEXT,
  \"mediaUrl\"      TEXT,
  \"status\"        \"WhatsAppStatus\" NOT NULL DEFAULT 'PENDING',
  \"providerMessageId\" TEXT,
  \"providerResponse\"  JSONB,
  \"failureReason\" TEXT,
  \"sentAt\"        TIMESTAMP(3),
  \"deliveredAt\"   TIMESTAMP(3),
  \"readAt\"        TIMESTAMP(3),
  \"createdAt\"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"whatsapp_messages_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"whatsapp_messages_merchantId_idx\"
  ON \"whatsapp_messages\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"whatsapp_messages_invoiceId_idx\"
  ON \"whatsapp_messages\"(\"invoiceId\");

CREATE INDEX IF NOT EXISTS \"whatsapp_messages_status_idx\"
  ON \"whatsapp_messages\"(\"status\");
""")

print()
print("-" * 70)
print("SECTION 3: bank_connections table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"bank_connections\" (
  \"id\"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"     TEXT NOT NULL,
  \"provider\"       \"BankProvider\" NOT NULL,
  \"accountHolder\"  TEXT NOT NULL,
  \"accountNumber\"  TEXT,
  \"iban\"           TEXT,
  \"currency\"       TEXT NOT NULL DEFAULT 'TRY',
  \"branchCode\"     TEXT,
  \"branchName\"     TEXT,
  \"status\"         \"BankConnectionStatus\" NOT NULL DEFAULT 'PENDING',
  \"accessToken\"    TEXT,
  \"refreshToken\"   TEXT,
  \"tokenExpiresAt\" TIMESTAMP(3),
  \"lastSyncAt\"     TIMESTAMP(3),
  \"lastSyncError\"  TEXT,
  \"providerData\"   JSONB,
  \"createdAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"bank_connections_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"bank_connections_merchantId_idx\"
  ON \"bank_connections\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"bank_connections_provider_idx\"
  ON \"bank_connections\"(\"provider\");

CREATE INDEX IF NOT EXISTS \"bank_connections_status_idx\"
  ON \"bank_connections\"(\"status\");

CREATE UNIQUE INDEX IF NOT EXISTS \"bank_connections_iban_key\"
  ON \"bank_connections\"(\"iban\")
  WHERE \"iban\" IS NOT NULL;
""")

print()
print("-" * 70)
print("SECTION 4: bank_transactions table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"bank_transactions\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"connectionId\"     TEXT NOT NULL,
  \"providerTxnId\"    TEXT,
  \"direction\"        \"BankTxnDirection\" NOT NULL,
  \"amount\"           DECIMAL(18, 2) NOT NULL,
  \"currency\"         TEXT NOT NULL DEFAULT 'TRY',
  \"description\"      TEXT,
  \"counterpartyName\" TEXT,
  \"counterpartyIban\" TEXT,
  \"reference\"        TEXT,
  \"transactionDate\"  TIMESTAMP(3) NOT NULL,
  \"valueDate\"        TIMESTAMP(3),
  \"balanceAfter\"     DECIMAL(18, 2),
  \"category\"         TEXT,
  \"matchedInvoiceId\" TEXT,
  \"matchedExpenseId\" TEXT,
  \"providerData\"     JSONB,
  \"createdAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"bank_transactions_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE,
  CONSTRAINT \"bank_transactions_connectionId_fkey\"
    FOREIGN KEY (\"connectionId\") REFERENCES \"bank_connections\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"bank_transactions_merchantId_idx\"
  ON \"bank_transactions\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"bank_transactions_connectionId_idx\"
  ON \"bank_transactions\"(\"connectionId\");

CREATE INDEX IF NOT EXISTS \"bank_transactions_transactionDate_idx\"
  ON \"bank_transactions\"(\"transactionDate\" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS \"bank_transactions_provider_uniq\"
  ON \"bank_transactions\"(\"connectionId\", \"providerTxnId\")
  WHERE \"providerTxnId\" IS NOT NULL;
""")

print()
print("-" * 70)
print("SECTION 5: Verification")
print("-" * 70)
print("""
-- Check all 4 enums exist
SELECT typname FROM pg_type
WHERE typname IN ('WhatsAppStatus', 'BankProvider', 'BankConnectionStatus', 'BankTxnDirection')
ORDER BY typname;

-- Check all 3 tables exist
SELECT tablename FROM pg_tables
WHERE tablename IN ('whatsapp_messages', 'bank_connections', 'bank_transactions')
ORDER BY tablename;
""")
print()
print("=" * 70)
print("RUN ORDER: Section 1 -> 2 -> 3 -> 4 -> 5 (verification)")
print("=" * 70)
