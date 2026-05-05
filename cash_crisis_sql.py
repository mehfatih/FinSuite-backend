print("=" * 70)
print("Cash Crisis - SQL Migration")
print("=" * 70)
print()
print("Run on Railway > FinSuite Postgres > Data > Query")
print()

print("-" * 70)
print("SECTION 1: New enums")
print("-" * 70)
print("""
CREATE TYPE \"CashCrisisSeverity\" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE \"CashCrisisType\" AS ENUM (
  'NEGATIVE_TREND',
  'OVERDUE_AR',
  'TAX_DUE',
  'PAYROLL_RISK',
  'BURN_RATE',
  'INVOICE_GAP',
  'EXPENSE_SPIKE'
);

CREATE TYPE \"CashCrisisStatus\" AS ENUM (
  'ACTIVE',
  'DISMISSED',
  'RESOLVED',
  'EXPIRED'
);
""")

print()
print("-" * 70)
print("SECTION 2: cash_crisis_alerts table")
print("-" * 70)
print("""
CREATE TABLE IF NOT EXISTS \"cash_crisis_alerts\" (
  \"id\"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  \"merchantId\"       TEXT NOT NULL,
  \"type\"             \"CashCrisisType\" NOT NULL,
  \"severity\"         \"CashCrisisSeverity\" NOT NULL,
  \"status\"           \"CashCrisisStatus\" NOT NULL DEFAULT 'ACTIVE',
  \"title\"            TEXT NOT NULL,
  \"message\"          TEXT NOT NULL,
  \"recommendation\"   TEXT,
  \"daysUntilCrisis\"  INTEGER,
  \"predictedDate\"    TIMESTAMP(3),
  \"impactAmount\"     DECIMAL(18, 2),
  \"currency\"         TEXT NOT NULL DEFAULT 'TRY',
  \"signals\"          JSONB,
  \"aiInsight\"        TEXT,
  \"dismissedAt\"      TIMESTAMP(3),
  \"resolvedAt\"       TIMESTAMP(3),
  \"createdAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \"updatedAt\"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \"cash_crisis_alerts_merchantId_fkey\"
    FOREIGN KEY (\"merchantId\") REFERENCES \"merchants\"(\"id\") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \"cash_crisis_alerts_merchantId_idx\"
  ON \"cash_crisis_alerts\"(\"merchantId\");

CREATE INDEX IF NOT EXISTS \"cash_crisis_alerts_status_idx\"
  ON \"cash_crisis_alerts\"(\"status\");

CREATE INDEX IF NOT EXISTS \"cash_crisis_alerts_severity_idx\"
  ON \"cash_crisis_alerts\"(\"severity\");

CREATE INDEX IF NOT EXISTS \"cash_crisis_alerts_predicted_idx\"
  ON \"cash_crisis_alerts\"(\"predictedDate\");
""")

print()
print("-" * 70)
print("SECTION 3: Verification")
print("-" * 70)
print("""
SELECT typname FROM pg_type
WHERE typname IN ('CashCrisisSeverity', 'CashCrisisType', 'CashCrisisStatus')
ORDER BY typname;

SELECT tablename FROM pg_tables WHERE tablename = 'cash_crisis_alerts';
""")
print()
print("=" * 70)
