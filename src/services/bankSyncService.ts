// ============================================================
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
