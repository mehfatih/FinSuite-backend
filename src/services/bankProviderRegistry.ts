// ============================================================
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
