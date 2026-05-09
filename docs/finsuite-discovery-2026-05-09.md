# FinSuite — Test Merchant Seed Discovery Report

**Date:** 2026-05-09
**Branch:** `main`
**Repo:** `zyrix-finsuite-backend`
**Scope:** Phase A of `finsuite-seed-and-verify.md` — read-only discovery to inform the seed script in Phase B and the AI Co-Pilot verification in Phase C.

---

## A.1 — KPI inventory

`src/services/customer/kpiComputations.ts:358–388` registers **25 KPI ids**. Of these, **12 actually compute** against the database; the remaining **13 hard-return `EMPTY`** (either by design — no underlying schema — or as aspirational placeholders).

> The prompt assumed 13 working / 13 EMPTY. Actual is **12 working / 13 EMPTY**. The extra EMPTY one is `payable_30d` (no `PurchaseInvoice` model and no `Expense.dueDate` in the schema).

### Working KPIs (12) — feed these in the seed

| KPI id | Function | Tables / fields read | Returns `EMPTY` when | Minimum data to return non-zero |
|---|---|---|---|---|
| `mrr` | `computeMrr` | `invoices` (`status=PAID`, `paidDate`, `total`) | exception | ≥1 PAID invoice with `paidDate` in current month |
| `mrr_growth_pct` | `computeMrrGrowthPct` | `invoices` | exception | ≥1 PAID this month + ≥1 PAID last month |
| `top_customer_revenue` | `computeTopCustomerRevenue` | `invoices.groupBy(customerName)` | exception | ≥1 PAID invoice this month (groups by `customerName` **string**) |
| `arpu` | `computeArpu` | `customers.count` + `invoices` | `customer count = 0` | ≥1 customer + ≥1 PAID invoice this month |
| `gross_margin` | `computeGrossMargin` | `invoices` + `expenses` | revenue this month = 0 | ≥1 PAID invoice this month |
| `new_customers_30d` | `computeNewCustomers30d` | `customers.createdAt` | exception | always returns count (0 if none); for non-zero, ≥1 customer with `createdAt` ≥ 30d ago |
| `cash_balance` | `computeCashBalance` | `bank_transactions` (sum IN − sum OUT) | exception | ≥1 `BankTransaction` row |
| `cash_runway` | `computeCashRunway` | `bank_transactions` + `expenses` last 30/60d | exception | BankTransactions + Expenses in last 30d (defaults to 365 if no burn) |
| `overdue_receivables` | `computeOverdueReceivables` | `invoices` (`status` in `SENT/OVERDUE`, `dueDate < now`) | exception | ≥1 `SENT` or `OVERDUE` invoice with past `dueDate` |
| `pending_invoices` | `computePendingInvoices` | `invoices` (`status` in `DRAFT/SENT`) | exception | always returns count; ≥1 `DRAFT`/`SENT` for non-zero |
| `customer_health_pct` | `computeCustomerHealthPct` | `customers.healthScore` | total customers = 0 | ≥1 customer; non-zero pct if ≥1 has `healthScore ≥ 70` |
| `tax_burden` | `computeTaxBurden` | `tax_events` (`isSubmitted=false`, `dueDate` in next 30d) | exception | ≥1 unsubmitted `TaxEvent` with `dueDate ≤ now+30d` |

### EMPTY KPIs (13) — cannot be made non-empty by seeding

| KPI id | Reason |
|---|---|
| `payable_30d` | No `PurchaseInvoice` model; `Expense` lacks `dueDate`. Hardcoded `EMPTY`. |
| `churn_rate` | Aspirational; no underlying data model. |
| `nrr` | Aspirational. |
| `ai_actions_taken_today` | Aspirational. |
| `predictions_accuracy_30d` | Aspirational. |
| `automation_savings_hours` | Aspirational. |
| `crisis_risk_score` | Aspirational (despite `CashCrisisAlert` table existing — the function is hardcoded EMPTY). |
| `hidden_cash_found_30d` | Aspirational. |
| `inventory_turnover` | Aspirational (`StockItem`/`StockMovement` exist but unused here). |
| `service_utilization` | Aspirational. |
| `kdv_load` | Aspirational. |
| `vat_load` | Aspirational. |
| `zatca_compliance` | Aspirational. |

> **Implication for Phase C verification:** Gemini will see `payable_30d: null` in its snapshot regardless of seeding, and will never see numbers for the 12 aspirational KPIs. Cards must reference what's *in* the snapshot — `mrr`, `cash_balance`, `cash_runway`, `overdue`, `pending_invoices`, `top_customer_revenue`, `tax_burden`, `customer_health_pct`, `new_customers_30d`, `mrr_growth_pct` (plus `context.invoice_count_30d` and `context.customer_count`). `arpu` and `gross_margin` compute but are NOT in `MerchantSnapshot.kpis` (`merchantSnapshot.ts:35–40`).

### Snapshot vs registry — note

`merchantSnapshot.ts:35` packs **11 of the 12** working KPIs (omits `arpu` and `gross_margin`) plus the always-EMPTY `payable_30d`. So Gemini's prompt will receive 10 numeric values (max), 1 always-null (`payable_30d`), and three context fields. Seeding `arpu`/`gross_margin` data is still useful for the dashboard but won't show up in the AI brief.

---

## A.2 — Merchant data model

The schema has **no** `Company` or `User` model. The customer-facing merchant identity is the **`Merchant`** model itself (`prisma/schema.prisma:362`), which carries auth credentials directly.

### `Merchant` (`merchants` table) — the relevant fields for seeding

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Used as `customerUserId` everywhere downstream. |
| `email` | `String @unique` | Login identifier. |
| `phone` | `String @unique` | **Required**, must be globally unique. Register endpoint validates Turkish format `+90...`; direct `prisma.merchant.create` bypasses that, but uniqueness is enforced at the DB level. |
| `passwordHash` | `String` | bcrypt, 12 rounds (matches `authController.ts:77,234`). |
| `language` | `Language` enum (`AR`/`TR`/`EN`) | Used by AI brief prompt language. |
| `currency` | `Currency` enum (`SAR`/`TRY`/`USD`/`EUR`) | |
| `country` | `String @default("TR")` | Free-form string. |
| `timezone` | `String @default("Europe/Istanbul")` | |
| `status` | `MerchantStatus` (`ACTIVE`/`SUSPENDED`/`TRIAL`/`EXPIRED`) | Login rejects `SUSPENDED`. |
| `plan` | `PlanName` enum | |
| `merchantId` | `String @unique @default(cuid())` | Public-facing identifier (separate from internal `id`). |

All child relations have `onDelete: Cascade`, so deleting a Merchant wipes invoices, customers, expenses, bank_transactions, tax_events, etc. Critical for cleanup script simplicity.

### Auth flow

`POST /api/auth/login` (`routes/auth.ts:9` → `controllers/authController.ts:135`):
1. Look up `Merchant.findUnique({ where: { email } })`.
2. `bcrypt.compare(password, merchant.passwordHash)`.
3. Sign JWT: `{ id, email, plan, language, currency }` with `env.jwtSecret`, expires `7d`.

The `authenticate` middleware (`middleware/auth.ts`) decodes the JWT and assigns the payload to `req.merchant`. The AI brief controller reads `req.merchant.id` (`aiBriefController.ts:222`) and uses it as `customerUserId` for the `CustomerDailyBrief` cache row (`schema.prisma:1832`).

### `Invoice` — key seeding details

| Field | Type | Notes |
|---|---|---|
| `merchantId` | FK → `Merchant.id` | Cascade delete. |
| `invoiceNumber` | `String @unique` | Globally unique across all merchants — must use deterministic prefixed names for idempotent re-seed. |
| `customerName` | `String` | **Free-form string**. There is **no `customerId` FK**. `top_customer_revenue` groups by this field, so it must exactly match `Customer.name`. |
| `subtotal`, `vatRate`, `vatAmount`, `total` | `Decimal` | KDV 20% / VAT 15% computed manually. |
| `currency` | `String @default("TRY")` | Free string, NOT the `Currency` enum. So `"SAR"` is fine. |
| `status` | `InvoiceStatus` enum (`DRAFT`/`SENT`/`PAID`/`OVERDUE`/`CANCELLED`) | |
| `dueDate` | `DateTime` (required) | |
| `paidDate` | `DateTime?` | Required when status=PAID for MRR to compute. |

### `Customer`

`(merchantId, name)` is **not** a unique constraint, so name collisions are allowed. We'll dedupe in the seed by `findFirst` → create.

### `Expense`

Has `merchantId`, `category`, `description`, `amount`, `currency`, `date`, `receipt?`. Used by:
- `cash_runway` (last 30d burn)
- `gross_margin` (this month's costs)

**No `dueDate`.** Cannot drive `payable_30d`.

### `BankTransaction`

Required fields: `merchantId`, `connectionId` (FK), `direction` (`IN`/`OUT`), `amount`, `transactionDate`. Drives `cash_balance` (`sum(IN) − sum(OUT)`). Each transaction needs a parent `BankConnection`.

### `TaxEvent`

`type` is the enum `TaxEventType`: `KDV` / `MUHTASAR` / `KURUMLAR` / `GELIR` / `DAMGA` / `SGK` / `OTHER`. **No `VAT`** — Saudi VAT must be modeled as `OTHER` with `title: "VAT"`. The KPI is type-agnostic (sums where `isSubmitted=false` and due in next 30d), so functionally fine.

---

## A.3 — AI brief data flow

```
POST /api/customer/dashboard/ai-brief/refresh
  └─ authenticate (JWT → req.merchant)
  └─ aiBriefController.refresh
       ├─ rate-limit check (60s per merchantId, in-memory Map)
       ├─ delete today's CustomerDailyBrief row
       └─ aiBriefController.getBrief
            ├─ check cache (CustomerDailyBrief) — miss now since just deleted
            ├─ buildMerchantSnapshot(merchantId, prisma, language, focus, currency)
            │     ├─ invokes 11 KPI fns from KPI_COMPUTATIONS in parallel
            │     ├─ counts invoices_30d, customers
            │     └─ returns MerchantSnapshot { kpis, context, currency, language, focus }
            ├─ callGemini(snapshot)
            │     ├─ buildPrompt(snapshot) → grounded in real numbers + ALLOWED_ROUTES list
            │     ├─ model.generateContent (gemini-2.0-flash) with 8s timeout race
            │     ├─ JSON.parse cleaned text (strip ```json fences)
            │     └─ sanitizeBrief — validates 3 cards, rewrites bad routes via prefix-distance to ALLOWED_ROUTES
            ├─ if generated → use it; else fallback to FALLBACK_BRIEF
            ├─ upsert into CustomerDailyBrief with expiresAt = next 06:00 local
            └─ return { brief, cached: false, fallback: !generated }
```

**Diagnostic logging** added in commit `1079a7b` (today): startup logs `GEMINI_API_KEY present` + length; `callGemini` logs every fail path (null genAI, timeout, empty text, JSON parse, sanitize reject, thrown error).

**Route mount** — confirmed actual path:
- `src/index.ts:92` → `app.use('/api/customer/dashboard', customerDashboardPrefsRoutes)`
- `src/routes/customer/dashboardPrefs.ts:20` → `router.post("/ai-brief/refresh", authenticate, aiBriefController.refresh)`
- **Effective URL: `POST /api/customer/dashboard/ai-brief/refresh`** (the prompt's `/api/customer/ai-brief/refresh` was wrong by one path segment).

---

## A.4 — Existing test infrastructure

- **Seeds directory:** `prisma/seeds/` exists, with one seed: `superAdmin.ts`. Convention: `prisma/seeds/<name>.ts`, run via `tsx`.
- **npm script convention:** `"seed:admin": "tsx prisma/seeds/superAdmin.ts"`.
- **No existing test merchants.** No test fixtures. No JWT minting helper. The single existing merchant in production is "Yilmaz" (zero invoices).
- **Password hashing:** runtime auth uses `bcrypt` (`controllers/authController.ts:77`); existing `superAdmin.ts` uses `bcryptjs`. Both packages installed; hashes are interoperable. New seed will use `bcrypt` to match the runtime path exactly.
- **No `is_test_merchant` flag column exists** anywhere. Phase B will use the **email convention** `test+*@finsuite.zyrix.co` as the marker, since the schema has no test-flag column and the email is already `@unique`.
- **No production-script invocation pattern** documented. Railway CLI (`railway run npm run …`) is the only path that picks up production env vars; will use that in Phase C.

---

## Discrepancies vs prompt (consolidated, 11)

| # | Prompt assumption | Reality | Resolution |
|---|---|---|---|
| 1 | 13 working KPIs | 12 working, 13 EMPTY | Doc reflects reality. Seed targets the 12. |
| 2 | Route `/api/customer/ai-brief/refresh` | `/api/customer/dashboard/ai-brief/refresh` | Phase C uses corrected URL. |
| 3 | `is_test_merchant` flag (with naming-convention fallback) | No such column | Use email convention: `test+tr@…` / `test+sa@…`. No migration. |
| 4 | `Company` / `User` models | Only `Merchant` (acts as both) | Seed creates `Merchant` rows directly. |
| 5 | (Implicit: any phone OK) | `Merchant.phone` is required + unique | Seed assigns unique phone strings; Saudi gets `+966...`. |
| 6 | Saudi VAT as a tax regime | `TaxEventType` enum is TR-only | Saudi tax events use `type: OTHER`, `title: "VAT"`. KPI is type-agnostic. |
| 7 | "CashMovement" table | No single such table | Income → `BankTransaction(IN)`; expenses → `Expense` rows mirrored as `BankTransaction(OUT)` to keep `cash_balance` consistent. |
| 8 | (Implicit: customer FK on invoice) | `Invoice.customerName` is a free string | Seed uses identical strings on `Customer.name` and `Invoice.customerName`. |
| 9 | `prisma/seed-test-merchants.ts` at root of `prisma/` | Convention is `prisma/seeds/<name>.ts` | Use `prisma/seeds/testMerchants.ts` and `prisma/seeds/cleanupTestMerchants.ts`. |
| 10 | (Implicit: no preference) | runtime uses `bcrypt`; existing seed uses `bcryptjs` | New seed uses `bcrypt` to match runtime. |
| 11 | Gemini cards reference all snapshot numbers | `payable_30d` is hard-coded EMPTY; aspirational KPIs ditto | Verification expects references to `mrr`, `top_customer_revenue`, `cash_runway`, `overdue_receivables`, `tax_burden`, `customer_health_pct`. `payable_30d` will always be `null`. |

---

## A.5 — Proposed seed plan

### Files (Phase B)

- **`prisma/seeds/testMerchants.ts`** — main seed. Idempotency strategy: at the top of the script, `prisma.merchant.deleteMany({ where: { email: { startsWith: "test+" } } })` (cascade clears all children), then create fresh. Simple, correct, matches the cleanup script's deletion criterion.
- **`prisma/seeds/cleanupTestMerchants.ts`** — same deletion logic, standalone.
- **`package.json`** — add `seed:test-merchants` and `cleanup:test-merchants` scripts.

### TR merchant (`Demir Tekstil A.Ş.`)

| Table | Rows | Detail |
|---|---|---|
| `merchants` | 1 | email `test+tr@finsuite.zyrix.co`, password `TestMerchantTR!2026` (bcrypt 12), phone `+905555550001`, `language=TR`, `currency=TRY`, `country=TR`, `timezone=Europe/Istanbul`, `status=ACTIVE`, `plan=PRO`. |
| `customers` | 3 | `Yılmaz Holding` (healthScore 85), `Kaya Tekstil Ltd.` (70), `Öztürk Group` (55). |
| `invoices` | 12 | One per month, June 2025 → May 2026 (current month). Distribution: Yılmaz 6 (~50%), Kaya 4 (~33%), Öztürk 2 (~17%). Status mix: 9 PAID / 2 SENT / 1 OVERDUE (~75/17/8). KDV 20%. Net amounts trend upward (₺16k → ₺30k). At least one PAID with `paidDate` in current month so `mrr > 0`. The OVERDUE invoice has past `dueDate` so `overdue_receivables > 0`. `customerName` strings exact-match `customers.name`. Deterministic invoice numbers `TST-TR-2025-06`…`TST-TR-2026-05` for re-seed safety. |
| `bank_connections` | 1 | One dummy connection (provider GARANTI, `status=CONNECTED`, currency TRY). Required parent for `BankTransaction`. |
| `bank_transactions` | ~21 | 9 IN rows mirroring PAID invoices; 12 OUT rows mirroring expenses. |
| `expenses` | 12 | One per month, categories rotated (rent / salaries / supplier). Total ~70% of monthly revenue → leaves positive margin. |
| `tax_events` | 3 | One past KDV (submitted), one current-cycle KDV (`isSubmitted=false`, `dueDate` ~20 days from now → drives `tax_burden`), one upcoming MUHTASAR. |

**Expected KPI snapshot (TR):**
- `mrr` ≈ ₺30,000 (latest May 2026 PAID invoice to Yılmaz)
- `mrr_growth_pct` ≈ +15% (current vs April)
- `top_customer_revenue` ≈ ₺30,000 (Yılmaz dominates current month)
- `cash_balance` ≈ +₺50–80k (income > expenses cumulatively)
- `cash_runway_days` ≈ 90–150 days
- `overdue_receivables` ≈ ₺24,000 (the one OVERDUE invoice from July 2025)
- `pending_invoices` = 2
- `new_customers_30d` = 3 (all customers seeded "now")
- `customer_health_pct` ≈ 33% (1 of 3 ≥70: Yılmaz only — actually Kaya is exactly 70, so 67%)
- `tax_burden` ≈ ₺5,000

### SA merchant (`مؤسسة الفهد التجارية`)

| Table | Rows | Detail |
|---|---|---|
| `merchants` | 1 | email `test+sa@finsuite.zyrix.co`, password `TestMerchantSA!2026`, phone `+966555550002`, `language=AR`, `currency=SAR`, `country=SA`, `timezone=Asia/Riyadh`, `status=ACTIVE`, `plan=PRO`. |
| `customers` | 3 | `شركة الراجحي للمقاولات` (85), `مؤسسة النخيل الذهبي` (70), `شركة الواحة` (55). |
| `invoices` | 12 | Same monthly pattern. Distribution Al-Rajhi 6 / Al-Nakheel 4 / Al-Waha 2. VAT 15%. Net amounts SAR 11k → SAR 22k trending upward. Same status mix. `currency="SAR"` on each row. Deterministic numbers `TST-SA-…`. |
| `bank_connections` | 1 | provider `OTHER`, currency SAR, `status=CONNECTED`. |
| `bank_transactions` | ~21 | Same pattern as TR. |
| `expenses` | 12 | Same pattern, scaled to SAR. |
| `tax_events` | 3 | All `type=OTHER`, `title="VAT"` / `"VAT (Q2)"` etc. One unsubmitted with due date in next 30d → drives `tax_burden`. |

### Totals

| Entity | TR | SA | Total |
|---|---:|---:|---:|
| Merchants | 1 | 1 | **2** |
| Customers | 3 | 3 | **6** |
| Invoices | 12 | 12 | **24** |
| Bank connections | 1 | 1 | 2 |
| Bank transactions | ~21 | ~21 | ~42 |
| Expenses | 12 | 12 | 24 |
| Tax events | 3 | 3 | 6 |

Matches Phase B.5 verification expectations.

### Phase C corrected verification command

```bash
# After login → $TOKEN_TR
curl -X POST https://finsuite-backend-production.up.railway.app/api/customer/dashboard/ai-brief/refresh \
  -H "Authorization: Bearer $TOKEN_TR" \
  -H "Content-Type: application/json"
```

(Note `/dashboard/` segment — corrected from prompt §C.4.)

### Success criteria for Phase C

- HTTP 200, `fallback: false` on both merchants
- Cards reference seeded numbers — likely candidates: MRR (~₺30k / ~SAR 22k), top customer (Yılmaz / Al-Rajhi), overdue (~₺24k / ~SAR 18k), tax burden (~₺5k / ~SAR 3k), customer health
- All `actionRoute` values in `ALLOWED_ROUTES` (sanitizer handles this — it'd only fail if Gemini hallucinated and the closest-match was the wrong rewrite, which is fine for verification purposes)
- TR brief in Turkish, SA brief in Arabic
