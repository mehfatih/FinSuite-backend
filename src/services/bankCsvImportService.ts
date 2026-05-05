// ============================================================
// Zyrix FinSuite - Bank CSV Import Service
// Sprint 1 Phase 2 - Real bank workaround
//
// Parses CSV exports from Turkish online banking and persists
// them as BankTransaction rows. Each bank has a slightly different
// CSV format - we detect by header signature.
//
// Supported banks:
//   GARANTI    - Garanti BBVA web export
//   IS_BANKASI - Is Bankasi web export
//   YAPI_KREDI - Yapi Kredi web export
//   AKBANK     - Akbank web export
//   ZIRAAT     - Ziraat web export
//   GENERIC    - Best-effort parse (auto-detect columns)
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

export type CsvParseResult = {
  importId: string;
  bankCode: string;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: Array<{ row: number; reason: string }>;
};

export type ParsedTxn = {
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

// ----------------------------------------------------------------
// CSV reader - handles BOM, quoted fields, multiple separators
// ----------------------------------------------------------------

function parseCsv(text: string): string[][] {
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Detect separator: try ; first (Turkish locale default), then ,
  const firstLine = text.split(/\r?\n/)[0] || "";
  const sepCandidates = [";", ",", "\t"];
  let separator = ",";
  let bestCount = 0;
  for (const s of sepCandidates) {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const c = (firstLine.match(new RegExp(escaped, "g")) || []).length;
    if (c > bestCount) {
      separator = s;
      bestCount = c;
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const QUOTE = '"';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          cell += QUOTE;
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === QUOTE) {
        inQuotes = true;
      } else if (ch === separator) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (cell !== "" || row.length > 0) {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = "";
        }
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ----------------------------------------------------------------
// Bank detection by header signature
// ----------------------------------------------------------------

function detectBank(headers: string[]): string {
  const joined = headers.join("|").toLowerCase();

  if (joined.includes("aciklama") && joined.includes("bakiye") && joined.includes("tutar")) {
    if (joined.includes("dekont")) return "GARANTI";
  }
  if (joined.includes("islem tarihi") && joined.includes("borc") && joined.includes("alacak")) {
    return "IS_BANKASI";
  }
  if (joined.includes("cikan") && joined.includes("giren")) {
    return "YAPI_KREDI";
  }
  if (joined.includes("karsi hesap") || joined.includes("karşı hesap")) {
    return "AKBANK";
  }
  if (joined.includes("islem tutari") || joined.includes("işlem tutarı")) {
    return "ZIRAAT";
  }
  return "GENERIC";
}

// ----------------------------------------------------------------
// Number parsing - handles Turkish format (1.234,56)
// ----------------------------------------------------------------

function parseAmount(s: string): number {
  if (!s) return 0;
  const cleaned = s.trim().replace(/\s/g, "");
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(cleaned.replace(/,/g, ""));
}

// ----------------------------------------------------------------
// Date parsing - dd.MM.yyyy, dd/MM/yyyy, yyyy-MM-dd
// ----------------------------------------------------------------

function parseDate(s: string): Date | null {
  if (!s) return null;
  const trimmed = s.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime())) return iso;
  }

  const m = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }
  return null;
}

// ----------------------------------------------------------------
// Generic row mapper - tries to figure out columns by header name
// ----------------------------------------------------------------

function mapRow(headers: string[], row: string[]): ParsedTxn | null {
  const h = headers.map((x) => x.toLowerCase().trim());
  const idx = (names: string[]) => {
    for (const name of names) {
      const i = h.findIndex((c) => c.includes(name));
      if (i >= 0) return i;
    }
    return -1;
  };

  const dateIdx = idx(["tarih", "islem tarihi", "transaction date", "date"]);
  const descIdx = idx(["aciklama", "açıklama", "description", "kayit"]);
  const refIdx = idx(["dekont", "ref", "reference", "evrak"]);
  const balIdx = idx(["bakiye", "balance"]);
  const counterIdx = idx(["karsi hesap", "karşı hesap", "counterparty", "alici"]);

  const txnDate = dateIdx >= 0 ? parseDate(row[dateIdx]) : null;
  if (!txnDate) return null;

  const inIdx = idx(["alacak", "giren", "credit", "in"]);
  const outIdx = idx(["borc", "cikan", "debit", "out"]);
  const amtIdx = idx(["tutar", "islem tutari", "işlem tutarı", "amount"]);

  let direction: "IN" | "OUT" = "IN";
  let amount = 0;

  if (inIdx >= 0 && outIdx >= 0) {
    const inAmt = parseAmount(row[inIdx] || "0");
    const outAmt = parseAmount(row[outIdx] || "0");
    if (outAmt > 0) {
      direction = "OUT";
      amount = outAmt;
    } else {
      direction = "IN";
      amount = inAmt;
    }
  } else if (amtIdx >= 0) {
    const a = parseAmount(row[amtIdx] || "0");
    direction = a >= 0 ? "IN" : "OUT";
    amount = Math.abs(a);
  } else {
    return null;
  }

  if (amount === 0) return null;

  const description = descIdx >= 0 ? (row[descIdx] || "").trim() : "";
  const reference = refIdx >= 0 ? (row[refIdx] || "").trim() : "";
  const counterparty = counterIdx >= 0 ? (row[counterIdx] || "").trim() : "";
  const balance = balIdx >= 0 ? parseAmount(row[balIdx] || "") : undefined;

  const providerTxnId =
    "csv-" + txnDate.toISOString().substring(0, 10) +
    "-" + amount +
    "-" + description.substring(0, 30).replace(/\s/g, "_");

  return {
    providerTxnId,
    direction,
    amount,
    currency: "TRY",
    description: description || undefined,
    counterpartyName: counterparty || undefined,
    reference: reference || undefined,
    transactionDate: txnDate,
    balanceAfter: balance && !isNaN(balance) ? balance : undefined,
  };
}

// ----------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------

export async function importCsvForMerchant(args: {
  merchantId: string;
  filename: string;
  csvText: string;
  connectionId?: string;
}): Promise<CsvParseResult> {
  const { merchantId, filename, csvText, connectionId } = args;

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error("Empty CSV");
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const bankCode = detectBank(headers);

  const importRecord = await prisma.bankCsvImport.create({
    data: {
      merchantId,
      connectionId: connectionId || null,
      filename,
      bankCode,
      status: "PROCESSING" as any,
      totalRows: dataRows.length,
    } as any,
  });

  const errors: Array<{ row: number; reason: string }> = [];
  let inserted = 0;
  let duplicates = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (row.every((c) => !c || c.trim() === "")) continue;

    const txn = mapRow(headers, row);
    if (!txn) {
      errors.push({ row: i + 2, reason: "Could not parse row" });
      continue;
    }

    try {
      await prisma.bankTransaction.create({
        data: {
          merchantId,
          connectionId: connectionId || null,
          providerTxnId: txn.providerTxnId,
          direction: txn.direction as any,
          amount: new Prisma.Decimal(txn.amount),
          currency: txn.currency,
          description: txn.description || null,
          counterpartyName: txn.counterpartyName || null,
          counterpartyIban: txn.counterpartyIban || null,
          reference: txn.reference || null,
          transactionDate: txn.transactionDate,
          valueDate: txn.valueDate || null,
          balanceAfter:
            txn.balanceAfter !== undefined && txn.balanceAfter !== null
              ? new Prisma.Decimal(txn.balanceAfter)
              : null,
          providerData: {
            source: "csv_import",
            importId: importRecord.id,
            originalRow: row,
          } as any,
        } as any,
      });
      inserted++;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        duplicates++;
      } else {
        errors.push({
          row: i + 2,
          reason: err instanceof Error ? err.message : "Insert failed",
        });
      }
    }
  }

  const finalStatus =
    errors.length === 0 ? "COMPLETED" : inserted > 0 ? "PARTIAL" : "FAILED";

  await prisma.bankCsvImport.update({
    where: { id: importRecord.id },
    data: {
      status: finalStatus as any,
      insertedRows: inserted,
      duplicateRows: duplicates,
      errorRows: errors.length,
      errorDetails: errors.length > 0 ? (errors as any) : undefined,
      completedAt: new Date(),
    } as any,
  });

  return {
    importId: importRecord.id,
    bankCode,
    totalRows: dataRows.length,
    insertedRows: inserted,
    duplicateRows: duplicates,
    errorRows: errors.length,
    errors: errors.slice(0, 50),
  };
}

export async function listCsvImports(merchantId: string, limit = 20) {
  return prisma.bankCsvImport.findMany({
    where: { merchantId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}
