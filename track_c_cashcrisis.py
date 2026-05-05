# ============================================================
# Cash Crisis - Combined backend batch
# ============================================================
from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("Cash Crisis - Backend batch")
print("=" * 70)

# ============================================================
# 1) Update prisma/schema.prisma
# ============================================================
SCHEMA = ROOT / "prisma" / "schema.prisma"
shutil.copy2(SCHEMA, SCHEMA.with_suffix(".prisma.backup-cashcrisis"))
print()
print("[1/6] Update schema.prisma")

text = SCHEMA.read_text(encoding="utf-8")

# Add new enums after BankTxnDirection
old_enum_anchor = """enum BankTxnDirection {
  IN
  OUT
}"""

new_enum_anchor = """enum BankTxnDirection {
  IN
  OUT
}

enum CashCrisisSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum CashCrisisType {
  NEGATIVE_TREND
  OVERDUE_AR
  TAX_DUE
  PAYROLL_RISK
  BURN_RATE
  INVOICE_GAP
  EXPENSE_SPIKE
}

enum CashCrisisStatus {
  ACTIVE
  DISMISSED
  RESOLVED
  EXPIRED
}"""

if "enum CashCrisisSeverity" not in text:
    if old_enum_anchor in text:
        text = text.replace(old_enum_anchor, new_enum_anchor, 1)
        print("    [OK] Added 3 enums")
    else:
        print("    [FAIL] BankTxnDirection anchor not found")
        raise SystemExit(1)

# Add CashCrisisAlert model after BankTransaction
m = re.search(
    r'(model BankTransaction \{[^}]*?@@map\("bank_transactions"\)\n\})',
    text, flags=re.DOTALL,
)
if not m:
    print("    [FAIL] BankTransaction model not found")
    raise SystemExit(1)

bank_block = m.group(1)
new_model = '''

model CashCrisisAlert {
  id              String              @id @default(uuid())
  merchantId      String
  type            CashCrisisType
  severity        CashCrisisSeverity
  status          CashCrisisStatus    @default(ACTIVE)
  title           String
  message         String
  recommendation  String?
  daysUntilCrisis Int?
  predictedDate   DateTime?
  impactAmount    Decimal?            @db.Decimal(18, 2)
  currency        String              @default("TRY")
  signals         Json?
  aiInsight       String?
  dismissedAt     DateTime?
  resolvedAt      DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  merchant        Merchant            @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([status])
  @@index([severity])
  @@index([predictedDate])
  @@map("cash_crisis_alerts")
}'''

if "model CashCrisisAlert" not in text:
    text = text.replace(bank_block, bank_block + new_model, 1)
    print("    [OK] Added CashCrisisAlert model")

# Add Merchant relation
old_rels = '''  whatsappMessages  WhatsAppMessage[]
  bankConnections   BankConnection[]
  bankTransactions  BankTransaction[]
  muhasebeciLinks   MuhasebeciLink[]'''

new_rels = '''  whatsappMessages  WhatsAppMessage[]
  bankConnections   BankConnection[]
  bankTransactions  BankTransaction[]
  cashCrisisAlerts  CashCrisisAlert[]
  muhasebeciLinks   MuhasebeciLink[]'''

if "cashCrisisAlerts" not in text:
    text = text.replace(old_rels, new_rels, 1)
    print("    [OK] Added Merchant.cashCrisisAlerts relation")

SCHEMA.write_text(text, encoding="utf-8")

# ============================================================
# 2) Create src/services/cashCrisisService.ts
# ============================================================
SVC = ROOT / "src" / "services" / "cashCrisisService.ts"
print()
print("[2/6] Create cashCrisisService.ts")

svc_content = '''// ============================================================
// Zyrix FinSuite - Cash Crisis Predictive Service
// Track C - Sprint 2 Feature 2
//
// Analyses live financial signals and emits crisis alerts
// before the merchant runs out of cash. Each detector is a
// pure function on aggregated data; the orchestrator runs
// them all and persists ACTIVE alerts.
// ============================================================

import { Prisma } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../config/database";
import { env } from "../config/env";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type DetectorOutput = {
  type:
    | "NEGATIVE_TREND"
    | "OVERDUE_AR"
    | "TAX_DUE"
    | "PAYROLL_RISK"
    | "BURN_RATE"
    | "INVOICE_GAP"
    | "EXPENSE_SPIKE";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
  recommendation?: string;
  daysUntilCrisis?: number;
  predictedDate?: Date;
  impactAmount?: number;
  signals?: any;
};

export type AnalysisResult = {
  success: boolean;
  alertsCreated: number;
  alertsExpired: number;
  detectorRuns: number;
  error?: string;
};

// ----------------------------------------------------------------
// Aggregate financial signals
// ----------------------------------------------------------------

async function gatherSignals(merchantId: string) {
  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 86400000);
  const days60 = new Date(now.getTime() - 60 * 86400000);
  const days90 = new Date(now.getTime() - 90 * 86400000);

  const [
    bankTxn30, bankTxn60, bankTxn90,
    overdueInv, expenses30, expenses60,
    upcomingTax, personnel, openInvCount,
    bankConnections,
  ] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { merchantId, transactionDate: { gte: days30 } },
      select: { amount: true, direction: true, balanceAfter: true, transactionDate: true, connectionId: true },
    }),
    prisma.bankTransaction.findMany({
      where: { merchantId, transactionDate: { gte: days60, lt: days30 } },
      select: { amount: true, direction: true },
    }),
    prisma.bankTransaction.findMany({
      where: { merchantId, transactionDate: { gte: days90, lt: days60 } },
      select: { amount: true, direction: true },
    }),
    prisma.invoice.findMany({
      where: { merchantId, status: "OVERDUE" as any },
      select: { total: true, dueDate: true, customerName: true },
    }),
    prisma.expense.aggregate({
      where: { merchantId, date: { gte: days30 } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { merchantId, date: { gte: days60, lt: days30 } },
      _sum: { amount: true },
    }),
    prisma.taxEvent.findMany({
      where: {
        merchantId,
        dueDate: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.personnel.findMany({
      where: { merchantId, status: "ACTIVE" as any },
      select: { salary: true, name: true },
    }),
    prisma.invoice.count({
      where: { merchantId, createdAt: { gte: days30 } },
    }),
    prisma.bankConnection.findMany({
      where: { merchantId, status: "CONNECTED" as any },
      select: { id: true },
    }),
  ]);

  // Sum helpers
  const sumIn = (rows: Array<{ amount: any; direction: any }>) =>
    rows.filter((r) => String(r.direction) === "IN").reduce((s, r) => s + Number(r.amount), 0);
  const sumOut = (rows: Array<{ amount: any; direction: any }>) =>
    rows.filter((r) => String(r.direction) === "OUT").reduce((s, r) => s + Number(r.amount), 0);

  // Latest balance per connection
  const latestByConn = new Map<string, number>();
  const sortedTxns = [...bankTxn30].sort(
    (a, b) => +new Date(b.transactionDate) - +new Date(a.transactionDate)
  );
  for (const t of sortedTxns) {
    if (!latestByConn.has(t.connectionId) && t.balanceAfter !== null) {
      latestByConn.set(t.connectionId, Number(t.balanceAfter));
    }
  }
  const currentBalance = Array.from(latestByConn.values()).reduce((s, v) => s + v, 0);

  return {
    currentBalance,
    cashIn30: sumIn(bankTxn30),
    cashOut30: sumOut(bankTxn30),
    netCash30: sumIn(bankTxn30) - sumOut(bankTxn30),
    cashIn60: sumIn(bankTxn60),
    cashOut60: sumOut(bankTxn60),
    netCash60: sumIn(bankTxn60) - sumOut(bankTxn60),
    cashIn90: sumIn(bankTxn90),
    cashOut90: sumOut(bankTxn90),
    netCash90: sumIn(bankTxn90) - sumOut(bankTxn90),
    overdueInvoiceCount: overdueInv.length,
    overdueAmount: overdueInv.reduce((s, i) => s + Number(i.total), 0),
    overdueInvoices: overdueInv,
    expenses30: Number(expenses30._sum.amount || 0),
    expenseCount30: expenses30._count || 0,
    expenses60: Number(expenses60._sum.amount || 0),
    upcomingTax,
    personnelMonthlyPayroll: personnel.reduce((s, p) => s + Number((p as any).salary || 0), 0),
    openInvoicesLast30Days: openInvCount,
    hasConnectedBanks: bankConnections.length > 0,
  };
}

// ----------------------------------------------------------------
// Detectors
// ----------------------------------------------------------------

function detectNegativeTrend(s: any): DetectorOutput | null {
  if (!s.hasConnectedBanks) return null;
  if (s.netCash30 >= 0) return null;

  // We have negative cashflow. Is it accelerating?
  const trend = s.netCash30 - s.netCash60;  // more negative = accelerating

  // Project: if current burn rate continues, when does balance hit zero?
  const monthlyBurn = -s.netCash30; // positive number = monthly burn
  if (monthlyBurn <= 0) return null;

  const daysUntilZero = Math.floor((s.currentBalance / monthlyBurn) * 30);
  if (daysUntilZero < 0 || daysUntilZero > 180) return null;

  let severity: DetectorOutput["severity"] = "LOW";
  if (daysUntilZero <= 14) severity = "CRITICAL";
  else if (daysUntilZero <= 30) severity = "HIGH";
  else if (daysUntilZero <= 60) severity = "MEDIUM";

  return {
    type: "NEGATIVE_TREND",
    severity,
    title: severity === "CRITICAL"
      ? "Nakit Krizi Cok Yakinda"
      : "Nakit Akisi Negatif",
    message: "Son 30 gunde net nakit akisiniz " +
      Math.round(s.netCash30).toLocaleString("tr-TR") +
      " TRY. Mevcut bakiyenizle yaklasik " + daysUntilZero +
      " gun dayanir.",
    recommendation: severity === "CRITICAL"
      ? "Acil olarak alacak tahsilatini hizlandirin ve gereksiz harcamalari durdurun."
      : "Onumuzdeki 30 gunde gelirinizi artiracak veya giderlerinizi azaltacak adimlar atin.",
    daysUntilCrisis: daysUntilZero,
    predictedDate: new Date(Date.now() + daysUntilZero * 86400000),
    impactAmount: monthlyBurn,
    signals: { netCash30: s.netCash30, netCash60: s.netCash60, trend, currentBalance: s.currentBalance },
  };
}

function detectOverdueAR(s: any): DetectorOutput | null {
  if (s.overdueAmount < 1000) return null;

  const monthlyBurn = Math.max(s.expenses30, 5000);
  const arRatio = s.overdueAmount / monthlyBurn;

  let severity: DetectorOutput["severity"] = "LOW";
  if (arRatio >= 2) severity = "HIGH";
  else if (arRatio >= 1) severity = "MEDIUM";

  return {
    type: "OVERDUE_AR",
    severity,
    title: "Vadesi Gecmis Alacaklar Yuksek",
    message: s.overdueInvoiceCount + " fatura toplamda " +
      Math.round(s.overdueAmount).toLocaleString("tr-TR") +
      " TRY tutarinda vadesi gecmis durumda.",
    recommendation: "WhatsApp uzerinden hatirlatma gonderin ve mumkunse erken odeme indirimi onerin.",
    impactAmount: s.overdueAmount,
    signals: { overdueAmount: s.overdueAmount, count: s.overdueInvoiceCount, arRatio },
  };
}

function detectTaxDue(s: any): DetectorOutput | null {
  if (!s.upcomingTax || s.upcomingTax.length === 0) return null;

  const next = s.upcomingTax[0];
  const daysUntil = Math.ceil((+new Date(next.dueDate) - Date.now()) / 86400000);
  if (daysUntil > 21) return null;

  const expectedAmount = Number((next as any).amount || 0);

  let severity: DetectorOutput["severity"] = "LOW";
  if (expectedAmount > 0 && expectedAmount > s.currentBalance) severity = "CRITICAL";
  else if (daysUntil <= 7) severity = "HIGH";
  else if (daysUntil <= 14) severity = "MEDIUM";

  return {
    type: "TAX_DUE",
    severity,
    title: "Yaklasan Vergi Odemesi",
    message: String((next as any).eventType || "Vergi") + " odemesi " +
      daysUntil + " gun icinde." +
      (expectedAmount > 0 ? " Beklenen tutar: " + expectedAmount.toLocaleString("tr-TR") + " TRY." : ""),
    recommendation: severity === "CRITICAL"
      ? "Mevcut bakiyeniz vergi tutarindan az. Acil tahsilat yapin veya kredi seceneklerini degerlendirin."
      : "Vergi tutarini ayri bir hesapta hazir tutun.",
    daysUntilCrisis: daysUntil,
    predictedDate: new Date((next as any).dueDate),
    impactAmount: expectedAmount,
    signals: { taxType: (next as any).eventType, dueDate: (next as any).dueDate },
  };
}

function detectPayrollRisk(s: any): DetectorOutput | null {
  if (s.personnelMonthlyPayroll <= 0) return null;
  if (s.currentBalance > s.personnelMonthlyPayroll * 1.5) return null;

  const ratio = s.currentBalance / s.personnelMonthlyPayroll;

  let severity: DetectorOutput["severity"] = "LOW";
  if (ratio < 0.5) severity = "CRITICAL";
  else if (ratio < 1) severity = "HIGH";
  else severity = "MEDIUM";

  return {
    type: "PAYROLL_RISK",
    severity,
    title: "Maas Odeme Riski",
    message: "Mevcut bakiyeniz aylik maaslarin " +
      (ratio * 100).toFixed(0) + "%'sini karsilar. Aylik maas tutari: " +
      Math.round(s.personnelMonthlyPayroll).toLocaleString("tr-TR") + " TRY.",
    recommendation: "Maas odeme tarihinden once acil tahsilat ve nakit yonetim plani olusturun.",
    impactAmount: s.personnelMonthlyPayroll,
    signals: { balance: s.currentBalance, payroll: s.personnelMonthlyPayroll, ratio },
  };
}

function detectBurnRate(s: any): DetectorOutput | null {
  // Compare last 30d expenses to 30-60 days ago
  if (s.expenses60 < 1000) return null;
  if (s.expenses30 < s.expenses60 * 1.3) return null;

  const increase = s.expenses30 - s.expenses60;
  const pct = (increase / s.expenses60) * 100;

  let severity: DetectorOutput["severity"] = "LOW";
  if (pct >= 100) severity = "HIGH";
  else if (pct >= 50) severity = "MEDIUM";

  return {
    type: "EXPENSE_SPIKE",
    severity,
    title: "Gider Artisi",
    message: "Son 30 gunde giderleriniz onceki 30 gune gore %" +
      pct.toFixed(0) + " arttı. Fark: " +
      Math.round(increase).toLocaleString("tr-TR") + " TRY.",
    recommendation: "Buyuk giderleri inceleyin ve tekrar etmeyecek olanlari belirleyin.",
    impactAmount: increase,
    signals: { expenses30: s.expenses30, expenses60: s.expenses60, pct },
  };
}

function detectInvoiceGap(s: any): DetectorOutput | null {
  if (!s.hasConnectedBanks) return null;
  if (s.openInvoicesLast30Days >= 3) return null;

  return {
    type: "INVOICE_GAP",
    severity: "MEDIUM",
    title: "Dusuk Faturalama Aktivitesi",
    message: "Son 30 gunde sadece " + s.openInvoicesLast30Days +
      " yeni fatura olusturuldu. Gelir azalisi riski.",
    recommendation: "Aktif satis pipelineiniza odaklanin ve bekleyen tekliflerinizi takip edin.",
    signals: { openInvoicesLast30Days: s.openInvoicesLast30Days },
  };
}

const DETECTORS = [
  detectNegativeTrend,
  detectOverdueAR,
  detectTaxDue,
  detectPayrollRisk,
  detectBurnRate,
  detectInvoiceGap,
];

// ----------------------------------------------------------------
// Optional: enrich with AI insight (best-effort, non-blocking)
// ----------------------------------------------------------------

async function enrichWithAI(out: DetectorOutput, s: any): Promise<string | null> {
  if (!env.geminiApiKey) return null;
  try {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
    });
    const prompt =
      "You are a senior CFO advisor. Briefly explain (max 80 words, in Turkish) why this is a risk and give 1 concrete action.\\n\\n" +
      "Alert: " + out.title + "\\n" +
      "Detail: " + out.message + "\\n" +
      "Signals: " + JSON.stringify(out.signals || {});
    const r = await model.generateContent(prompt);
    return r.response.text().trim().substring(0, 600);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------
// Orchestrator: run analysis for one merchant
// ----------------------------------------------------------------

export async function analyzeMerchant(merchantId: string): Promise<AnalysisResult> {
  try {
    const signals = await gatherSignals(merchantId);

    let created = 0;

    // Expire old alerts that are no longer relevant (status=ACTIVE, predictedDate < now - 7d)
    const expired = await prisma.cashCrisisAlert.updateMany({
      where: {
        merchantId,
        status: "ACTIVE" as any,
        predictedDate: { lt: new Date(Date.now() - 7 * 86400000) },
      },
      data: { status: "EXPIRED" as any } as any,
    });

    // Run all detectors
    for (const detector of DETECTORS) {
      const out = detector(signals);
      if (!out) continue;

      // Dedupe: if an active alert of same type exists in last 24h, skip
      const recent = await prisma.cashCrisisAlert.findFirst({
        where: {
          merchantId,
          type: out.type as any,
          status: "ACTIVE" as any,
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        },
      });
      if (recent) continue;

      // Best-effort AI enrichment
      const aiInsight = await enrichWithAI(out, signals);

      await prisma.cashCrisisAlert.create({
        data: {
          merchantId,
          type: out.type as any,
          severity: out.severity as any,
          status: "ACTIVE" as any,
          title: out.title,
          message: out.message,
          recommendation: out.recommendation || null,
          daysUntilCrisis: out.daysUntilCrisis ?? null,
          predictedDate: out.predictedDate || null,
          impactAmount: out.impactAmount !== undefined
            ? new Prisma.Decimal(out.impactAmount)
            : null,
          signals: out.signals as any,
          aiInsight: aiInsight || null,
        } as any,
      });
      created++;
    }

    return {
      success: true,
      alertsCreated: created,
      alertsExpired: expired.count,
      detectorRuns: DETECTORS.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, alertsCreated: 0, alertsExpired: 0, detectorRuns: 0, error: msg };
  }
}
'''

SVC.write_text(svc_content, encoding="utf-8")
print("    [OK] Created (size: " + str(SVC.stat().st_size) + " bytes)")

# ============================================================
# 3) Create src/controllers/cashCrisisController.ts
# ============================================================
CTRL = ROOT / "src" / "controllers" / "cashCrisisController.ts"
print()
print("[3/6] Create cashCrisisController.ts")

ctrl_content = '''// ============================================================
// Zyrix FinSuite - Cash Crisis Controller
// Track C - Sprint 2 Feature 2
//
// Endpoints (all authenticated):
//   GET    /api/cash-crisis           list active alerts
//   GET    /api/cash-crisis/all       list including dismissed/resolved
//   POST   /api/cash-crisis/analyze   trigger analysis on demand
//   POST   /api/cash-crisis/:id/dismiss
//   POST   /api/cash-crisis/:id/resolve
// ============================================================

import { Request, Response } from "express";
import { prisma } from "../config/database";
import { analyzeMerchant } from "../services/cashCrisisService";
import { pid } from "../utils/params";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET / - active only
// ----------------------------------------------------------------

export async function listActiveHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.cashCrisisAlert.findMany({
    where: { merchantId: req.merchant.id, status: "ACTIVE" as any },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// GET /all
// ----------------------------------------------------------------

export async function listAllHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.cashCrisisAlert.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /analyze
// ----------------------------------------------------------------

export async function analyzeHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const result = await analyzeMerchant(req.merchant.id);
  if (!result.success) {
    return fail(res, 500, result.error || "Analysis failed");
  }
  return ok(res, result);
}

// ----------------------------------------------------------------
// POST /:id/dismiss
// ----------------------------------------------------------------

export async function dismissHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const existing = await prisma.cashCrisisAlert.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Alert not found");

  const updated = await prisma.cashCrisisAlert.update({
    where: { id },
    data: { status: "DISMISSED" as any, dismissedAt: new Date() } as any,
  });
  return ok(res, updated);
}

// ----------------------------------------------------------------
// POST /:id/resolve
// ----------------------------------------------------------------

export async function resolveHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const existing = await prisma.cashCrisisAlert.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!existing) return fail(res, 404, "Alert not found");

  const updated = await prisma.cashCrisisAlert.update({
    where: { id },
    data: { status: "RESOLVED" as any, resolvedAt: new Date() } as any,
  });
  return ok(res, updated);
}
'''

CTRL.write_text(ctrl_content, encoding="utf-8")
print("    [OK] Created (size: " + str(CTRL.stat().st_size) + " bytes)")

# ============================================================
# 4) Create src/routes/cashCrisis.ts
# ============================================================
RT = ROOT / "src" / "routes" / "cashCrisis.ts"
print()
print("[4/6] Create cashCrisis.ts route")

rt_content = '''// ============================================================
// Zyrix FinSuite - Cash Crisis Routes
// Track C - Sprint 2 Feature 2
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  listActiveHandler,
  listAllHandler,
  analyzeHandler,
  dismissHandler,
  resolveHandler,
} from "../controllers/cashCrisisController";

const router = Router();
router.use(authenticate as any);

const analyzeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Analysis can be run at most 10 times per hour.",
  },
});

router.get("/",                  listActiveHandler as any);
router.get("/all",               listAllHandler as any);
router.post("/analyze",          analyzeRateLimiter, analyzeHandler as any);
router.post("/:id/dismiss",      dismissHandler as any);
router.post("/:id/resolve",      resolveHandler as any);

export default router;
'''

RT.write_text(rt_content, encoding="utf-8")
print("    [OK] Created")

# ============================================================
# 5) Wire into src/index.ts
# ============================================================
INDEX = ROOT / "src" / "index.ts"
shutil.copy2(INDEX, INDEX.with_suffix(".ts.backup-cashcrisis"))
print()
print("[5/6] Wire into src/index.ts")

idx = INDEX.read_text(encoding="utf-8")

new_imp = 'import cashCrisisRoutes    from "./routes/cashCrisis";'
new_use = 'app.use("/api/cash-crisis",    cashCrisisRoutes);'

if "cashCrisisRoutes" not in idx:
    idx = idx.replace(
        'import aiCfoVoiceRoutes from "./routes/aiCfoVoice";',
        'import aiCfoVoiceRoutes from "./routes/aiCfoVoice";\n' + new_imp,
        1,
    )
    print("    [OK] Import added")

if '"/api/cash-crisis"' not in idx:
    idx = idx.replace(
        'app.use("/api/ai-cfo", aiCfoVoiceRoutes);',
        'app.use("/api/ai-cfo", aiCfoVoiceRoutes);\n' + new_use,
        1,
    )
    print("    [OK] Route registered")

# Bump version
idx = idx.replace("Zyrix FinSuite v3.5", "Zyrix FinSuite v3.6", 1)
idx = idx.replace("21 features | 37 routes", "22 features | 42 routes", 1)
INDEX.write_text(idx, encoding="utf-8")

# ============================================================
# 6) Verification
# ============================================================
print()
print("[6/6] Verification")
final = INDEX.read_text(encoding="utf-8")
schema_final = SCHEMA.read_text(encoding="utf-8")
checks = [
    ("schema: 3 enums",          all(e in schema_final for e in ["enum CashCrisisSeverity", "enum CashCrisisType", "enum CashCrisisStatus"])),
    ("schema: CashCrisisAlert",  "model CashCrisisAlert" in schema_final),
    ("schema: Merchant relation","cashCrisisAlerts" in schema_final),
    ("Service exists",           SVC.exists()),
    ("Controller exists",        CTRL.exists()),
    ("Route exists",             RT.exists()),
    ("/api/cash-crisis wired",   '"/api/cash-crisis"' in final),
    ("v3.6",                     "v3.6" in final),
    ("22 features | 42 routes",  "22 features | 42 routes" in final),
]
passed = 0
for label, ok_check in checks:
    s = "OK" if ok_check else "MISSING"
    if ok_check: passed += 1
    print("     " + label.ljust(35) + " -> " + s)
print()
print("RESULT: " + str(passed) + "/" + str(len(checks)) + " checks passed")
print("=" * 70)
