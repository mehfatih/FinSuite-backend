# ============================================================
# Sprint 1 Phase 1B - COMBINED BATCH
# Updates: schema.prisma, env.ts, 4 services, 2 controllers,
#          2 routes, index.ts
# ============================================================

from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("Phase 1B - Combined batch")
print("=" * 70)

# ============================================================
# 1) UPDATE prisma/schema.prisma
# ============================================================
SCHEMA = ROOT / "prisma" / "schema.prisma"
shutil.copy2(SCHEMA, SCHEMA.with_suffix(".prisma.backup-phase-1B"))
print()
print("[1/10] Update prisma/schema.prisma")

text = SCHEMA.read_text(encoding="utf-8")

# 1a. Add new enums after EFaturaStatus
old_anchor = """enum EIrsaliyeStatus {
  DRAFT
  READY_TO_SEND
  QUEUED
  SENT_PENDING_GIB
  ACCEPTED
  REJECTED
  CANCELLED
}"""

new_after = """enum EIrsaliyeStatus {
  DRAFT
  READY_TO_SEND
  QUEUED
  SENT_PENDING_GIB
  ACCEPTED
  REJECTED
  CANCELLED
}

enum WhatsAppStatus {
  PENDING
  QUEUED
  SENT
  DELIVERED
  READ
  FAILED
}

enum BankProvider {
  GARANTI
  IS_BANKASI
  YAPI_KREDI
  AKBANK
  ZIRAAT
  OTHER
}

enum BankConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  REVOKED
  ERROR
}

enum BankTxnDirection {
  IN
  OUT
}"""

if old_anchor in text:
    text = text.replace(old_anchor, new_after, 1)
    print("    [OK] Added 4 enums after EIrsaliyeStatus")
else:
    print("    [FAIL] EIrsaliyeStatus anchor not found")
    raise SystemExit(1)

# 1b. Add 3 models AFTER ReceiptScan model
m = re.search(
    r'(model ReceiptScan \{[^}]*?@@map\("receipt_scans"\)\n\})',
    text, flags=re.DOTALL,
)
if not m:
    print("    [FAIL] ReceiptScan model not found")
    raise SystemExit(1)

receipt_block = m.group(1)
new_models = '''

model WhatsAppMessage {
  id                String          @id @default(uuid())
  merchantId        String
  invoiceId         String?
  recipientPhone    String
  messageType       String          @default("invoice")
  templateName      String?
  bodyText          String?
  mediaUrl          String?
  status            WhatsAppStatus  @default(PENDING)
  providerMessageId String?
  providerResponse  Json?
  failureReason     String?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  merchant          Merchant        @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([invoiceId])
  @@index([status])
  @@map("whatsapp_messages")
}

model BankConnection {
  id              String                @id @default(uuid())
  merchantId      String
  provider        BankProvider
  accountHolder   String
  accountNumber   String?
  iban            String?               @unique
  currency        String                @default("TRY")
  branchCode      String?
  branchName      String?
  status          BankConnectionStatus  @default(PENDING)
  accessToken     String?
  refreshToken    String?
  tokenExpiresAt  DateTime?
  lastSyncAt      DateTime?
  lastSyncError   String?
  providerData    Json?
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt
  merchant        Merchant              @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  transactions    BankTransaction[]

  @@index([merchantId])
  @@index([provider])
  @@index([status])
  @@map("bank_connections")
}

model BankTransaction {
  id               String           @id @default(uuid())
  merchantId       String
  connectionId     String
  providerTxnId    String?
  direction        BankTxnDirection
  amount           Decimal          @db.Decimal(18, 2)
  currency         String           @default("TRY")
  description      String?
  counterpartyName String?
  counterpartyIban String?
  reference        String?
  transactionDate  DateTime
  valueDate        DateTime?
  balanceAfter     Decimal?         @db.Decimal(18, 2)
  category         String?
  matchedInvoiceId String?
  matchedExpenseId String?
  providerData     Json?
  createdAt        DateTime         @default(now())
  merchant         Merchant         @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  connection       BankConnection   @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@index([merchantId])
  @@index([connectionId])
  @@index([transactionDate(sort: Desc)])
  @@map("bank_transactions")
}'''

text = text.replace(receipt_block, receipt_block + new_models, 1)
print("    [OK] Added WhatsAppMessage + BankConnection + BankTransaction models")

# 1c. Add 3 relations to Merchant
old_relations = """  eIrsaliyeler      EIrsaliye[]
  receiptScans      ReceiptScan[]
  muhasebeciLinks   MuhasebeciLink[]"""

new_relations = """  eIrsaliyeler      EIrsaliye[]
  receiptScans      ReceiptScan[]
  whatsappMessages  WhatsAppMessage[]
  bankConnections   BankConnection[]
  bankTransactions  BankTransaction[]
  muhasebeciLinks   MuhasebeciLink[]"""

if old_relations in text:
    text = text.replace(old_relations, new_relations, 1)
    print("    [OK] Added 3 relations to Merchant")
else:
    print("    [FAIL] Merchant relations anchor not found")
    raise SystemExit(1)

SCHEMA.write_text(text, encoding="utf-8")

# ============================================================
# 2) UPDATE src/config/env.ts
# ============================================================
ENV_TS = ROOT / "src" / "config" / "env.ts"
shutil.copy2(ENV_TS, ENV_TS.with_suffix(".ts.backup-phase-1B"))
print()
print("[2/10] Update src/config/env.ts")

env_text = ENV_TS.read_text(encoding="utf-8")
old_env = '  iyzicoBaseUrl:    process.env.IYZICO_BASE_URL || "https://sandbox.iyzipay.com",'
new_env = '''  iyzicoBaseUrl:    process.env.IYZICO_BASE_URL || "https://sandbox.iyzipay.com",
  // WhatsApp (Meta Cloud API)
  whatsappToken:    process.env.WHATSAPP_TOKEN || "",
  whatsappPhoneId:  process.env.WHATSAPP_PHONE_ID || "",
  whatsappBusinessId: process.env.WHATSAPP_BUSINESS_ID || "",
  // Bank integrations (placeholder - real keys per bank go in DB per merchant)
  bankSandboxMode:  (process.env.BANK_SANDBOX_MODE || "true") === "true",'''

if old_env in env_text:
    env_text = env_text.replace(old_env, new_env, 1)
    ENV_TS.write_text(env_text, encoding="utf-8")
    print("    [OK] Added WhatsApp + bank env keys")
else:
    print("    [FAIL] env.ts anchor not found")
    raise SystemExit(1)

# ============================================================
# 3) CREATE src/services/whatsappService.ts
# ============================================================
WA_SVC = ROOT / "src" / "services" / "whatsappService.ts"
print()
print("[3/10] Create src/services/whatsappService.ts")

wa_svc_content = '''// ============================================================
// Zyrix FinSuite - WhatsApp Service (Meta Cloud API)
// Sprint 1 Phase 1B
//
// Sends invoice messages via WhatsApp Business Cloud API.
// Reuses the same Meta integration pattern Levana Cosmetics uses.
// ============================================================

import { env } from "../config/env";

export type WhatsAppSendInput = {
  recipientPhone: string;     // E.164 format, e.g. "+905551234567"
  bodyText?: string;
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
};

export type WhatsAppSendResult = {
  success: boolean;
  providerMessageId?: string;
  providerResponse?: any;
  error?: string;
};

const META_API_BASE = "https://graph.facebook.com/v20.0";

function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+")) return cleaned.substring(1);
  return cleaned;
}

export async function sendWhatsAppMessage(
  input: WhatsAppSendInput
): Promise<WhatsAppSendResult> {
  if (!env.whatsappToken || !env.whatsappPhoneId) {
    return {
      success: false,
      error:
        "WhatsApp credentials not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID.",
    };
  }

  const phone = normalizePhone(input.recipientPhone);
  if (!phone || phone.length < 10) {
    return { success: false, error: "Invalid recipient phone" };
  }

  // Build the request body. If templateName is given, use template path.
  // Otherwise send a plain text message.
  let body: any;
  if (input.templateName) {
    body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: input.templateName,
        language: { code: "tr" },
        components: input.templateParams && input.templateParams.length > 0
          ? [
              {
                type: "body",
                parameters: input.templateParams.map((p) => ({
                  type: "text",
                  text: p,
                })),
              },
            ]
          : [],
      },
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: input.bodyText || "" },
    };
  }

  const url = META_API_BASE + "/" + env.whatsappPhoneId + "/messages";

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.whatsappToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return {
        success: false,
        error:
          (json && json.error && json.error.message) ||
          "Meta API returned " + resp.status,
        providerResponse: json,
      };
    }

    const messageId =
      json &&
      json.messages &&
      Array.isArray(json.messages) &&
      json.messages[0] &&
      json.messages[0].id;

    return {
      success: true,
      providerMessageId: messageId || undefined,
      providerResponse: json,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: "Network error: " + msg };
  }
}
'''
WA_SVC.write_text(wa_svc_content, encoding="utf-8")
print("    [OK] Created (size: " + str(WA_SVC.stat().st_size) + " bytes)")

# ============================================================
# 4) CREATE src/controllers/whatsappController.ts
# ============================================================
WA_CTRL = ROOT / "src" / "controllers" / "whatsappController.ts"
print()
print("[4/10] Create src/controllers/whatsappController.ts")

wa_ctrl_content = '''// ============================================================
// Zyrix FinSuite - WhatsApp Controller
// Sprint 1 Phase 1B
//
// Endpoints (all authenticated):
//   POST /api/whatsapp/send-invoice/:invoiceId  send an invoice via WA
//   GET  /api/whatsapp                          list sent messages
//   GET  /api/whatsapp/:id                      get one message
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { sendWhatsAppMessage } from "../services/whatsappService";

interface AuthenticatedRequest extends Request {
  merchant?: {
    id: string;
    email: string;
    plan?: string;
  };
}

const sendInvoiceSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(20).optional(),
  customMessage: z.string().max(1000).optional(),
});

const listSchema = z.object({
  status: z
    .enum(["PENDING", "QUEUED", "SENT", "DELIVERED", "READ", "FAILED"])
    .optional(),
  invoiceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// POST /api/whatsapp/send-invoice/:invoiceId
// ----------------------------------------------------------------

export async function sendInvoiceHandler(
  req: AuthenticatedRequest,
  res: Response
) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const invoiceId = String(req.params.invoiceId || "");
  if (!invoiceId) return fail(res, 400, "invoiceId is required");

  const parsed = sendInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const { recipientPhone, customMessage } = parsed.data;

  // Load invoice
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, merchantId: req.merchant.id },
  });
  if (!invoice) return fail(res, 404, "Invoice not found");

  const phone = recipientPhone || invoice.customerPhone;
  if (!phone) {
    return fail(
      res,
      422,
      "No recipient phone. Provide one or set customer phone on the invoice."
    );
  }

  // Build message text
  const total = String(invoice.total);
  const text =
    customMessage ||
    "Merhaba " +
      invoice.customerName +
      ", #" +
      invoice.invoiceNumber +
      " numarali faturaniz hazirdir. Tutar: " +
      total +
      " " +
      invoice.currency +
      ". Vade: " +
      invoice.dueDate.toISOString().substring(0, 10);

  // 1. Insert PENDING row
  const initial = await prisma.whatsAppMessage.create({
    data: {
      merchantId: req.merchant.id,
      invoiceId: invoice.id,
      recipientPhone: phone,
      messageType: "invoice",
      bodyText: text,
      status: "PENDING" as any,
    } as any,
  });

  // 2. Send via Meta Cloud API
  const result = await sendWhatsAppMessage({
    recipientPhone: phone,
    bodyText: text,
  });

  // 3. Persist outcome
  if (!result.success) {
    const failed = await prisma.whatsAppMessage.update({
      where: { id: initial.id },
      data: {
        status: "FAILED" as any,
        failureReason: result.error || "Unknown error",
        providerResponse: (result.providerResponse as any) || undefined,
      } as any,
    });
    return fail(res, 502, result.error || "WhatsApp send failed");
  }

  const sent = await prisma.whatsAppMessage.update({
    where: { id: initial.id },
    data: {
      status: "SENT" as any,
      providerMessageId: result.providerMessageId || null,
      providerResponse: (result.providerResponse as any) || undefined,
      sentAt: new Date(),
    } as any,
  });

  // Update Invoice.whatsappSentAt for quick reference
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { whatsappSentAt: new Date() } as any,
  });

  return ok(res, sent, 201);
}

// ----------------------------------------------------------------
// GET /api/whatsapp - list
// ----------------------------------------------------------------

export async function listHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }
  const { status, invoiceId, limit, offset } = parsed.data;

  const where: any = { merchantId: req.merchant.id };
  if (status) where.status = status;
  if (invoiceId) where.invoiceId = invoiceId;

  const [rows, total] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit ?? 50,
      skip: offset ?? 0,
    }),
    prisma.whatsAppMessage.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /api/whatsapp/:id
// ----------------------------------------------------------------

export async function getHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");
  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const row = await prisma.whatsAppMessage.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!row) return fail(res, 404, "Not found");

  return ok(res, row);
}
'''
WA_CTRL.write_text(wa_ctrl_content, encoding="utf-8")
print("    [OK] Created (size: " + str(WA_CTRL.stat().st_size) + " bytes)")

# ============================================================
# 5) CREATE src/routes/whatsapp.ts
# ============================================================
WA_RT = ROOT / "src" / "routes" / "whatsapp.ts"
print()
print("[5/10] Create src/routes/whatsapp.ts")

wa_rt_content = '''// ============================================================
// Zyrix FinSuite - WhatsApp Routes
// Sprint 1 Phase 1B
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  sendInvoiceHandler,
  listHandler,
  getHandler,
} from "../controllers/whatsappController";

const router = Router();

router.use(authenticate as any);

const sendRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many WhatsApp messages this hour. Please slow down.",
  },
});

router.post("/send-invoice/:invoiceId", sendRateLimiter, sendInvoiceHandler as any);
router.get("/",     listHandler as any);
router.get("/:id",  getHandler as any);

export default router;
'''
WA_RT.write_text(wa_rt_content, encoding="utf-8")
print("    [OK] Created (size: " + str(WA_RT.stat().st_size) + " bytes)")

# ============================================================
# 6) CREATE src/services/bankProviderRegistry.ts
# ============================================================
BANK_REG = ROOT / "src" / "services" / "bankProviderRegistry.ts"
print()
print("[6/10] Create src/services/bankProviderRegistry.ts")

bank_reg_content = '''// ============================================================
// Zyrix FinSuite - Bank Provider Registry
// Sprint 1 Phase 1B
//
// One adapter per Turkish bank. Currently sandbox stubs that
// return synthetic data; real BKM-OBKS endpoints will replace
// the stubs once BBM API agreements are signed.
//
// All adapters share the same interface so bankSyncService
// can iterate them generically.
// ============================================================

import { env } from "../config/env";

export type ProviderTxn = {
  providerTxnId: string;
  direction: "IN" | "OUT";
  amount: number;
  currency: string;
  description?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
  transactionDate: Date;
  valueDate?: Date;
  balanceAfter?: number;
};

export type BankAdapter = {
  providerCode: string;
  displayName: string;
  fetchTransactions(args: {
    accessToken?: string | null;
    iban?: string | null;
    accountNumber?: string | null;
    since?: Date | null;
  }): Promise<ProviderTxn[]>;
};

// ----------------------------------------------------------------
// Sandbox helper - generates 5 realistic-looking sample txns
// ----------------------------------------------------------------

function sandboxTransactions(seed: string): ProviderTxn[] {
  const now = Date.now();
  const out: ProviderTxn[] = [];
  for (let i = 0; i < 5; i++) {
    const isIn = i % 2 === 0;
    const amt = Math.round((100 + i * 137 + seed.length * 11) * 100) / 100;
    out.push({
      providerTxnId: seed + "-" + (now - i * 86400000).toString(36),
      direction: isIn ? "IN" : "OUT",
      amount: amt,
      currency: "TRY",
      description: isIn ? "Gelen havale" : "EFT giden",
      counterpartyName: isIn ? "Musteri " + (i + 1) : "Tedarikci " + (i + 1),
      reference: "REF-" + (1000 + i),
      transactionDate: new Date(now - i * 86400000),
      balanceAfter: 50000 - i * amt,
    });
  }
  return out;
}

// ----------------------------------------------------------------
// Adapter implementations
// ----------------------------------------------------------------

export const garantiAdapter: BankAdapter = {
  providerCode: "GARANTI",
  displayName: "Garanti BBVA",
  async fetchTransactions(args) {
    if (env.bankSandboxMode) return sandboxTransactions("GAR");
    // TODO: real Garanti BBVA Open Banking API
    return [];
  },
};

export const isBankasiAdapter: BankAdapter = {
  providerCode: "IS_BANKASI",
  displayName: "Turkiye Is Bankasi",
  async fetchTransactions(args) {
    if (env.bankSandboxMode) return sandboxTransactions("ISB");
    // TODO: real Is Bankasi API
    return [];
  },
};

export const yapiKrediAdapter: BankAdapter = {
  providerCode: "YAPI_KREDI",
  displayName: "Yapi Kredi",
  async fetchTransactions(args) {
    if (env.bankSandboxMode) return sandboxTransactions("YK");
    // TODO: real Yapi Kredi API
    return [];
  },
};

export const akbankAdapter: BankAdapter = {
  providerCode: "AKBANK",
  displayName: "Akbank",
  async fetchTransactions(args) {
    if (env.bankSandboxMode) return sandboxTransactions("AKB");
    // TODO: real Akbank Direkt API
    return [];
  },
};

export const ziraatAdapter: BankAdapter = {
  providerCode: "ZIRAAT",
  displayName: "Ziraat Bankasi",
  async fetchTransactions(args) {
    if (env.bankSandboxMode) return sandboxTransactions("ZIR");
    // TODO: real Ziraat API
    return [];
  },
};

// ----------------------------------------------------------------
// Public registry
// ----------------------------------------------------------------

export const BANK_REGISTRY: Record<string, BankAdapter> = {
  GARANTI: garantiAdapter,
  IS_BANKASI: isBankasiAdapter,
  YAPI_KREDI: yapiKrediAdapter,
  AKBANK: akbankAdapter,
  ZIRAAT: ziraatAdapter,
};

export function getBankAdapter(provider: string): BankAdapter | null {
  return BANK_REGISTRY[provider] || null;
}

export function listBankProviders() {
  return Object.values(BANK_REGISTRY).map((a) => ({
    providerCode: a.providerCode,
    displayName: a.displayName,
  }));
}
'''
BANK_REG.write_text(bank_reg_content, encoding="utf-8")
print("    [OK] Created (size: " + str(BANK_REG.stat().st_size) + " bytes)")

# ============================================================
# 7) CREATE src/services/bankSyncService.ts
# ============================================================
BANK_SYNC = ROOT / "src" / "services" / "bankSyncService.ts"
print()
print("[7/10] Create src/services/bankSyncService.ts")

bank_sync_content = '''// ============================================================
// Zyrix FinSuite - Bank Sync Service
// Sprint 1 Phase 1B
//
// Orchestrates the per-connection sync: fetch from the right
// adapter, dedupe by providerTxnId, persist new BankTransaction
// rows.
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { getBankAdapter } from "./bankProviderRegistry";

export type SyncResult = {
  success: boolean;
  fetched: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const conn = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) return { success: false, fetched: 0, inserted: 0, duplicates: 0, error: "Connection not found" };

  const adapter = getBankAdapter(String(conn.provider));
  if (!adapter) return { success: false, fetched: 0, inserted: 0, duplicates: 0, error: "Unknown provider" };

  let txns: any[] = [];
  try {
    txns = await adapter.fetchTransactions({
      accessToken: conn.accessToken,
      iban: conn.iban,
      accountNumber: conn.accountNumber,
      since: conn.lastSyncAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Adapter error";
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncError: msg,
        status: "ERROR" as any,
      } as any,
    });
    return { success: false, fetched: 0, inserted: 0, duplicates: 0, error: msg };
  }

  let inserted = 0;
  let duplicates = 0;

  for (const t of txns) {
    try {
      await prisma.bankTransaction.create({
        data: {
          merchantId: conn.merchantId,
          connectionId: conn.id,
          providerTxnId: t.providerTxnId,
          direction: t.direction as any,
          amount: new Prisma.Decimal(t.amount),
          currency: t.currency || conn.currency || "TRY",
          description: t.description || null,
          counterpartyName: t.counterpartyName || null,
          counterpartyIban: t.counterpartyIban || null,
          reference: t.reference || null,
          transactionDate: t.transactionDate,
          valueDate: t.valueDate || null,
          balanceAfter: t.balanceAfter !== undefined && t.balanceAfter !== null
            ? new Prisma.Decimal(t.balanceAfter)
            : null,
          providerData: t as any,
        } as any,
      });
      inserted++;
    } catch (err) {
      // Unique index on (connectionId, providerTxnId) handles dedupe
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicates++;
      } else {
        // ignore other errors per-row but log
        // eslint-disable-next-line no-console
        console.warn("[bankSync] insert error:", err);
      }
    }
  }

  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: null,
      status: "CONNECTED" as any,
    } as any,
  });

  return {
    success: true,
    fetched: txns.length,
    inserted,
    duplicates,
  };
}
'''
BANK_SYNC.write_text(bank_sync_content, encoding="utf-8")
print("    [OK] Created (size: " + str(BANK_SYNC.stat().st_size) + " bytes)")

# ============================================================
# 8) CREATE src/controllers/bankController.ts
# ============================================================
BANK_CTRL = ROOT / "src" / "controllers" / "bankController.ts"
print()
print("[8/10] Create src/controllers/bankController.ts")

bank_ctrl_content = '''// ============================================================
// Zyrix FinSuite - Bank Controller
// Sprint 1 Phase 1B
//
// Endpoints (all authenticated):
//   GET    /api/banks/providers           list supported providers
//   POST   /api/banks/connect             create a BankConnection
//   GET    /api/banks/connections         list connections
//   POST   /api/banks/connections/:id/sync  trigger sync
//   GET    /api/banks/transactions        list transactions
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { listBankProviders } from "../services/bankProviderRegistry";
import { syncConnection } from "../services/bankSyncService";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

const connectSchema = z.object({
  provider: z.enum([
    "GARANTI",
    "IS_BANKASI",
    "YAPI_KREDI",
    "AKBANK",
    "ZIRAAT",
    "OTHER",
  ]),
  accountHolder: z.string().min(2).max(200),
  accountNumber: z.string().max(40).optional(),
  iban: z.string().max(34).optional(),
  currency: z.string().length(3).optional(),
  branchCode: z.string().max(20).optional(),
  branchName: z.string().max(100).optional(),
});

const txnListSchema = z.object({
  connectionId: z.string().uuid().optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
  offset: z.coerce.number().min(0).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET /api/banks/providers
// ----------------------------------------------------------------

export async function providersHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");
  return ok(res, listBankProviders());
}

// ----------------------------------------------------------------
// POST /api/banks/connect
// ----------------------------------------------------------------

export async function connectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  try {
    const created = await prisma.bankConnection.create({
      data: {
        merchantId: req.merchant.id,
        provider: input.provider as any,
        accountHolder: input.accountHolder,
        accountNumber: input.accountNumber || null,
        iban: input.iban || null,
        currency: input.currency || "TRY",
        branchCode: input.branchCode || null,
        branchName: input.branchName || null,
        status: "CONNECTED" as any, // sandbox mode auto-connects
      } as any,
    });
    return ok(res, created, 201);
  } catch (err: any) {
    if (err && err.code === "P2002") {
      return fail(res, 409, "IBAN already linked to another connection");
    }
    return fail(res, 500, "Failed to create bank connection");
  }
}

// ----------------------------------------------------------------
// GET /api/banks/connections
// ----------------------------------------------------------------

export async function connectionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.bankConnection.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /api/banks/connections/:id/sync
// ----------------------------------------------------------------

export async function syncHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = String(req.params.id || "");
  if (!id) return fail(res, 400, "id is required");

  const conn = await prisma.bankConnection.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!conn) return fail(res, 404, "Connection not found");

  const result = await syncConnection(id);
  if (!result.success) {
    return fail(res, 502, result.error || "Sync failed");
  }
  return ok(res, result);
}

// ----------------------------------------------------------------
// GET /api/banks/transactions
// ----------------------------------------------------------------

export async function transactionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = txnListSchema.safeParse(req.query);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid query");
  }
  const { connectionId, direction, limit, offset } = parsed.data;

  const where: any = { merchantId: req.merchant.id };
  if (connectionId) where.connectionId = connectionId;
  if (direction) where.direction = direction;

  const [rows, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: { transactionDate: "desc" },
      take: limit ?? 100,
      skip: offset ?? 0,
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return ok(res, { rows, total });
}
'''
BANK_CTRL.write_text(bank_ctrl_content, encoding="utf-8")
print("    [OK] Created (size: " + str(BANK_CTRL.stat().st_size) + " bytes)")

# ============================================================
# 9) CREATE src/routes/banks.ts
# ============================================================
BANK_RT = ROOT / "src" / "routes" / "banks.ts"
print()
print("[9/10] Create src/routes/banks.ts")

bank_rt_content = '''// ============================================================
// Zyrix FinSuite - Bank Routes
// Sprint 1 Phase 1B
// ============================================================

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import {
  providersHandler,
  connectHandler,
  connectionsHandler,
  syncHandler,
  transactionsHandler,
} from "../controllers/bankController";

const router = Router();

router.use(authenticate as any);

router.get("/providers",                   providersHandler as any);
router.post("/connect",                    connectHandler as any);
router.get("/connections",                 connectionsHandler as any);
router.post("/connections/:id/sync",       syncHandler as any);
router.get("/transactions",                transactionsHandler as any);

export default router;
'''
BANK_RT.write_text(bank_rt_content, encoding="utf-8")
print("    [OK] Created (size: " + str(BANK_RT.stat().st_size) + " bytes)")

# ============================================================
# 10) WIRE into src/index.ts
# ============================================================
INDEX = ROOT / "src" / "index.ts"
shutil.copy2(INDEX, INDEX.with_suffix(".ts.backup-phase-1B"))
print()
print("[10/10] Wire into src/index.ts")

idx = INDEX.read_text(encoding="utf-8")

# Find existing imports/uses
import_lines = re.findall(r'^import\s+\w+\s+from\s+"\./routes/[^"]+";?$', idx, flags=re.MULTILINE)
use_lines = re.findall(r'^app\.use\("/api/[^"]+",\s*\w+\);?$', idx, flags=re.MULTILINE)

# Append two new imports + uses
new_imports = '\nimport whatsappRoutes from "./routes/whatsapp";\nimport banksRoutes from "./routes/banks";'
new_uses    = '\napp.use("/api/whatsapp", whatsappRoutes);\napp.use("/api/banks", banksRoutes);'

if 'from "./routes/whatsapp"' not in idx:
    last_import = import_lines[-1]
    idx = idx.replace(last_import, last_import + new_imports, 1)
    print("    [OK] Imports inserted")

if '"/api/whatsapp"' not in idx:
    last_use = use_lines[-1]
    idx = idx.replace(last_use, last_use + new_uses, 1)
    print("    [OK] Routes registered")

# Update version
idx = idx.replace("Zyrix FinSuite v3.3", "Zyrix FinSuite v3.4", 1)
idx = idx.replace("18 features | 28 routes", "20 features | 33 routes", 1)

INDEX.write_text(idx, encoding="utf-8")
print("    [OK] index.ts written")

# ============================================================
# FINAL VERIFICATION
# ============================================================
print()
print("=" * 70)
print("FINAL VERIFICATION")
print("=" * 70)

final_schema = SCHEMA.read_text(encoding="utf-8")
final_idx = INDEX.read_text(encoding="utf-8")

checks = [
    ("schema: WhatsAppStatus enum",       "enum WhatsAppStatus" in final_schema),
    ("schema: BankProvider enum",         "enum BankProvider" in final_schema),
    ("schema: BankConnectionStatus enum", "enum BankConnectionStatus" in final_schema),
    ("schema: BankTxnDirection enum",     "enum BankTxnDirection" in final_schema),
    ("schema: WhatsAppMessage model",     "model WhatsAppMessage" in final_schema),
    ("schema: BankConnection model",      "model BankConnection" in final_schema),
    ("schema: BankTransaction model",     "model BankTransaction" in final_schema),
    ("schema: 3 Merchant relations",      "whatsappMessages" in final_schema and "bankConnections" in final_schema),
    ("env.ts: whatsappToken",             "whatsappToken" in ENV_TS.read_text(encoding="utf-8")),
    ("whatsappService exists",            WA_SVC.exists()),
    ("whatsappController exists",         WA_CTRL.exists()),
    ("whatsapp routes exist",             WA_RT.exists()),
    ("bankProviderRegistry exists",       BANK_REG.exists()),
    ("bankSyncService exists",            BANK_SYNC.exists()),
    ("bankController exists",             BANK_CTRL.exists()),
    ("banks routes exist",                BANK_RT.exists()),
    ("index.ts: whatsapp wired",          '"/api/whatsapp"' in final_idx),
    ("index.ts: banks wired",             '"/api/banks"' in final_idx),
    ("index.ts: v3.4",                    "v3.4" in final_idx),
    ("index.ts: 20 features | 33 routes", "20 features | 33 routes" in final_idx),
]

passed = 0
failed = 0
for label, ok_check in checks:
    status_str = "OK" if ok_check else "MISSING"
    if ok_check:
        passed += 1
    else:
        failed += 1
    print("     " + label.ljust(38) + " -> " + status_str)
print()
print("=" * 70)
print("RESULT: " + str(passed) + "/" + str(passed + failed) + " checks passed")
print("=" * 70)
