// ================================================================
// Test merchant seed — TR (Demir Tekstil A.Ş.) + SA (Al-Fahad).
// Run: npm run seed:test-merchants
//
// Idempotent: deletes any existing merchants whose email starts with
// "test+" (cascade clears all child rows), then recreates from scratch.
// Uses bcrypt 12 rounds to match runtime auth (controllers/authController.ts).
//
// Marker convention: email prefix "test+" — there is no is_test_merchant
// column in the schema (see docs/finsuite-discovery-2026-05-09.md §A.4).
// ================================================================
import {
  PrismaClient,
  InvoiceStatus,
  MerchantStatus,
  PlanName,
  BankProvider,
  BankConnectionStatus,
  BankTxnDirection,
  TaxEventType,
  Language,
  Currency,
} from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ─── Date helpers ───────────────────────────────────────────────
function monthDate(monthsAgo: number, day: number, hour = 12): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, hour, 0, 0, 0);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
function round500(n: number): number {
  return Math.round(n / 500) * 500;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Pattern: 12 invoices per merchant, indexed by monthsAgo (0..11)
// Slot L = largest customer (~50%), M = medium (~33%), S = small (~17%).
// Status mix targets ~75% PAID / ~17% SENT / ~8% OVERDUE.
type Slot = "L" | "M" | "S";
type Status = "PAID" | "SENT" | "OVERDUE";

const INVOICE_PATTERN: Array<{ slot: Slot; status: Status }> = [
  { slot: "L", status: "PAID" },     // monthsAgo=0  (current month)
  { slot: "M", status: "PAID" },     // 1
  { slot: "L", status: "PAID" },     // 2
  { slot: "S", status: "PAID" },     // 3
  { slot: "L", status: "PAID" },     // 4
  { slot: "M", status: "PAID" },     // 5
  { slot: "L", status: "PAID" },     // 6
  { slot: "M", status: "PAID" },     // 7
  { slot: "L", status: "SENT" },     // 8  (pending, due-date past → also counts as overdue)
  { slot: "S", status: "SENT" },     // 9  (pending)
  { slot: "L", status: "OVERDUE" },  // 10 (oldest unpaid)
  { slot: "M", status: "PAID" },     // 11 (oldest paid)
];

// ─── Merchant specs ─────────────────────────────────────────────
interface MerchantSpec {
  email:               string;
  password:            string;
  name:                string;
  businessName:        string;
  phone:               string;
  language:            Language;
  currency:            Currency;
  country:             string;
  timezone:            string;
  vatRate:             number;
  invoiceCurrency:     string;
  bankProvider:        BankProvider;
  customers:           Array<{ name: string; healthScore: number }>;  // [L, M, S]
  baseAmount:          Record<Slot, number>;
  itemDescription:     string;
  expenseRows:         Array<{ category: string; description: string; share: number }>;
  monthlyBurn:         number;
  taxEvents:           Array<{ type: TaxEventType; title: string; dueOffsetDays: number; isSubmitted: boolean; amount: number }>;
  invoiceNumberPrefix: string;
}

const TR_SPEC: MerchantSpec = {
  email:           "test+tr@finsuite.zyrix.co",
  password:        "TestMerchantTR!2026",
  name:            "Demir Tekstil A.Ş.",
  businessName:    "Demir Tekstil A.Ş.",
  phone:           "+905555550001",
  language:        Language.TR,
  currency:        Currency.TRY,
  country:         "TR",
  timezone:        "Europe/Istanbul",
  vatRate:         20,
  invoiceCurrency: "TRY",
  bankProvider:    BankProvider.GARANTI,
  customers: [
    { name: "Yılmaz Holding",      healthScore: 85 },
    { name: "Kaya Tekstil Ltd.",   healthScore: 70 },
    { name: "Öztürk Group",        healthScore: 55 },
  ],
  baseAmount:      { L: 25000, M: 17000, S: 12000 },
  itemDescription: "Aylık hizmet bedeli",
  expenseRows: [
    { category: "Kira",       description: "Ofis kirası",        share: 0.30 },
    { category: "Maaşlar",    description: "Personel maaşları",  share: 0.50 },
    { category: "Tedarikçi",  description: "Hammadde alımı",     share: 0.20 },
  ],
  monthlyBurn:     18000,
  taxEvents: [
    { type: TaxEventType.KDV,       title: "KDV Beyannamesi (Mart 2026)",   dueOffsetDays: -14, isSubmitted: true,  amount: 4500 },
    { type: TaxEventType.KDV,       title: "KDV Beyannamesi (Nisan 2026)",  dueOffsetDays: 17,  isSubmitted: false, amount: 5200 },
    { type: TaxEventType.MUHTASAR,  title: "Muhtasar Beyanname (Nisan 2026)", dueOffsetDays: 27, isSubmitted: false, amount: 1500 },
  ],
  invoiceNumberPrefix: "TST-TR",
};

const SA_SPEC: MerchantSpec = {
  email:           "test+sa@finsuite.zyrix.co",
  password:        "TestMerchantSA!2026",
  name:            "مؤسسة الفهد التجارية",
  businessName:    "Al-Fahad Trading Est.",
  phone:           "+966555550002",
  language:        Language.AR,
  currency:        Currency.SAR,
  country:         "SA",
  timezone:        "Asia/Riyadh",
  vatRate:         15,
  invoiceCurrency: "SAR",
  bankProvider:    BankProvider.OTHER,
  customers: [
    { name: "شركة الراجحي للمقاولات", healthScore: 85 },
    { name: "مؤسسة النخيل الذهبي",    healthScore: 70 },
    { name: "شركة الواحة",            healthScore: 55 },
  ],
  baseAmount:      { L: 18000, M: 13000, S: 9000 },
  itemDescription: "رسوم الخدمة الشهرية",
  expenseRows: [
    { category: "إيجار",     description: "إيجار المكتب",      share: 0.30 },
    { category: "رواتب",     description: "رواتب الموظفين",     share: 0.50 },
    { category: "مورّدون",   description: "مشتريات الموردين",   share: 0.20 },
  ],
  monthlyBurn:     12000,
  // Saudi VAT modeled as type=OTHER per discovery doc — TaxEventType enum is TR-only.
  taxEvents: [
    { type: TaxEventType.OTHER, title: "VAT (Q1 2026)",         dueOffsetDays: -14, isSubmitted: true,  amount: 3200 },
    { type: TaxEventType.OTHER, title: "VAT (Q2 2026)",         dueOffsetDays: 20,  isSubmitted: false, amount: 3800 },
    { type: TaxEventType.OTHER, title: "Quarterly VAT prep",    dueOffsetDays: 28,  isSubmitted: false, amount: 1100 },
  ],
  invoiceNumberPrefix: "TST-SA",
};

// ─── Per-merchant seed ──────────────────────────────────────────
async function seedMerchant(spec: MerchantSpec): Promise<{
  invoices: number; bankTxns: number; expenses: number;
}> {
  const passwordHash = await bcrypt.hash(spec.password, 12);

  const merchant = await prisma.merchant.create({
    data: {
      name:           spec.name,
      email:          spec.email,
      phone:          spec.phone,
      passwordHash,
      businessName:   spec.businessName,
      country:        spec.country,
      timezone:       spec.timezone,
      language:       spec.language,
      currency:       spec.currency,
      status:         MerchantStatus.ACTIVE,
      plan:           PlanName.PRO,
      onboardingDone: true,
    },
  });

  // Customers — vary createdAt so new_customers_30d > 0 (only the S slot is new).
  const customerCreatedAt: Date[] = [
    monthDate(11, 1),   // L: long-time customer
    monthDate(6, 1),    // M: mid-term
    daysFromNow(-14),   // S: new (within 30d window)
  ];
  const customers = await Promise.all(
    spec.customers.map((c, i) =>
      prisma.customer.create({
        data: {
          merchantId:  merchant.id,
          name:        c.name,
          healthScore: c.healthScore,
          createdAt:   customerCreatedAt[i],
        },
      })
    )
  );

  // Bank connection (parent for transactions).
  const bankConnection = await prisma.bankConnection.create({
    data: {
      merchantId:    merchant.id,
      provider:      spec.bankProvider,
      accountHolder: spec.name,
      currency:      spec.invoiceCurrency,
      status:        BankConnectionStatus.CONNECTED,
    },
  });

  // Invoices + matching IN bank transactions for PAID ones.
  let invoiceCount = 0;
  let bankInCount = 0;
  for (let i = 0; i < INVOICE_PATTERN.length; i++) {
    const monthsAgo = i;
    const { slot, status } = INVOICE_PATTERN[i];
    const customerIdx  = slot === "L" ? 0 : slot === "M" ? 1 : 2;
    const customerName = spec.customers[customerIdx].name;

    const issueDate = monthDate(monthsAgo, 5);
    const subtotal  = round500(spec.baseAmount[slot] * (1 + (11 - monthsAgo) * 0.02));
    const vatAmount = round2(subtotal * spec.vatRate / 100);
    const total     = round2(subtotal + vatAmount);
    const dueDate   = addDays(issueDate, 30);

    let paidDate: Date | null = null;
    if (status === "PAID") {
      paidDate = monthsAgo === 0 ? monthDate(0, 7) : addDays(issueDate, 14);
    }

    const invoice = await prisma.invoice.create({
      data: {
        merchantId:     merchant.id,
        invoiceNumber:  `${spec.invoiceNumberPrefix}-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, "0")}`,
        customerName,
        items: [
          {
            description: spec.itemDescription,
            quantity:    1,
            unitPrice:   subtotal,
            total:       subtotal,
          },
        ],
        subtotal,
        vatRate:        spec.vatRate,
        vatAmount,
        total,
        currency:       spec.invoiceCurrency,
        status:         status as InvoiceStatus,
        dueDate,
        paidDate,
      },
    });
    invoiceCount++;

    if (status === "PAID" && paidDate) {
      await prisma.bankTransaction.create({
        data: {
          merchantId:       merchant.id,
          connectionId:     bankConnection.id,
          direction:        BankTxnDirection.IN,
          amount:           total,
          currency:         spec.invoiceCurrency,
          description:      `Invoice ${invoice.invoiceNumber} payment`,
          counterpartyName: customerName,
          reference:        invoice.invoiceNumber,
          transactionDate:  paidDate,
        },
      });
      bankInCount++;
    }
  }

  // Expenses: 3 categories × 12 months = 36 rows. Mirror each as OUT bank txn
  // so cash_balance = sum(IN) − sum(OUT) reflects realistic post-expense cash.
  let expenseCount = 0;
  let bankOutCount = 0;
  for (let monthsAgo = 0; monthsAgo < 12; monthsAgo++) {
    for (const row of spec.expenseRows) {
      const date   = monthDate(monthsAgo, 10);
      const amount = round2(spec.monthlyBurn * row.share);

      await prisma.expense.create({
        data: {
          merchantId:  merchant.id,
          category:    row.category,
          description: row.description,
          amount,
          currency:    spec.invoiceCurrency,
          date,
        },
      });
      expenseCount++;

      await prisma.bankTransaction.create({
        data: {
          merchantId:      merchant.id,
          connectionId:    bankConnection.id,
          direction:       BankTxnDirection.OUT,
          amount,
          currency:        spec.invoiceCurrency,
          description:     `${row.category} — ${row.description}`,
          transactionDate: date,
        },
      });
      bankOutCount++;
    }
  }

  // Tax events.
  for (const t of spec.taxEvents) {
    await prisma.taxEvent.create({
      data: {
        merchantId:  merchant.id,
        type:        t.type,
        title:       t.title,
        dueDate:     daysFromNow(t.dueOffsetDays),
        amount:      t.amount,
        isPrepared:  t.isSubmitted,
        isSubmitted: t.isSubmitted,
        submittedAt: t.isSubmitted ? daysFromNow(t.dueOffsetDays - 1) : null,
      },
    });
  }

  console.log(
    `  ✓ ${spec.email}  →  merchant ${merchant.id}  ` +
    `[${customers.length} customers · ${invoiceCount} invoices · ` +
    `${bankInCount} IN + ${bankOutCount} OUT bank txns · ${expenseCount} expenses · ${spec.taxEvents.length} tax events]`
  );

  return { invoices: invoiceCount, bankTxns: bankInCount + bankOutCount, expenses: expenseCount };
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("Seeding test merchants (TR + SA)…\n");

  // Idempotency: wipe any prior test merchants (cascade clears all children).
  const wiped = await prisma.merchant.deleteMany({
    where: { email: { startsWith: "test+" } },
  });
  if (wiped.count > 0) {
    console.log(`  cleaned ${wiped.count} pre-existing test merchant(s)\n`);
  }

  const tr = await seedMerchant(TR_SPEC);
  const sa = await seedMerchant(SA_SPEC);

  // Sanity check vs Phase B.5 expectations.
  const totalMerchants = await prisma.merchant.count({
    where: { email: { startsWith: "test+" } },
  });
  const totalCustomers = await prisma.customer.count({
    where: { merchant: { email: { startsWith: "test+" } } },
  });
  const totalInvoices = await prisma.invoice.count({
    where: { merchant: { email: { startsWith: "test+" } } },
  });
  const totalBankTxns = await prisma.bankTransaction.count({
    where: { merchant: { email: { startsWith: "test+" } } },
  });
  const totalExpenses = await prisma.expense.count({
    where: { merchant: { email: { startsWith: "test+" } } },
  });

  console.log("\n─── Summary ────────────────────────────────────────");
  console.log(`  merchants:         ${totalMerchants}  (expected 2)`);
  console.log(`  customers:         ${totalCustomers}  (expected 6)`);
  console.log(`  invoices:          ${totalInvoices}  (expected 24)`);
  console.log(`  bank transactions: ${totalBankTxns}`);
  console.log(`  expenses:          ${totalExpenses}`);
  console.log("────────────────────────────────────────────────────\n");

  if (totalMerchants !== 2 || totalCustomers !== 6 || totalInvoices !== 24) {
    console.error("⚠ Counts do not match expectations.");
    process.exit(1);
  }

  console.log("✅ Test merchants seeded.");
  console.log("Login:");
  console.log(`  TR  →  ${TR_SPEC.email}  /  ${TR_SPEC.password}`);
  console.log(`  SA  →  ${SA_SPEC.email}  /  ${SA_SPEC.password}\n`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
