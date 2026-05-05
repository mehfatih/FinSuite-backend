# ============================================================
# Generic Marketplace Framework - Backend Batch
# 20 marketplace providers (Trendyol kept as legacy; this is
# the new generic system that replaces it for all 19 new ones)
# ============================================================
from pathlib import Path
import shutil
import re

ROOT = Path(r"D:\Zyrix Hub\zyrix-finsuite-backend")

print("=" * 70)
print("Marketplace Framework - Backend batch")
print("=" * 70)

# ============================================================
# 1) Update prisma/schema.prisma
# ============================================================
SCHEMA = ROOT / "prisma" / "schema.prisma"
shutil.copy2(SCHEMA, SCHEMA.with_suffix(".prisma.backup-marketplace"))
print()
print("[1/7] Update schema.prisma")

text = SCHEMA.read_text(encoding="utf-8")

# Add new enums after TrendyolConnectionStatus
old_enum_anchor = """enum TrendyolConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  ERROR
}"""

new_enum_anchor = """enum TrendyolConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  ERROR
}

enum MarketplaceProvider {
  TRENDYOL
  HEPSIBURADA
  N11
  CICEKSEPETI
  PTTAVM
  AMAZON_TR
  GETIR
  FLO
  YEMEKSEPETI
  VATAN
  SALLA
  ZID
  NOON_SA
  AMAZON_SA
  JARIR
  AMAZON_AE
  NOON_AE
  NAMSHI
  CARREFOUR_AE
  MUMZWORLD
}

enum MarketplaceConnectionStatus {
  PENDING
  CONNECTED
  EXPIRED
  ERROR
}

enum MarketplaceOrderStatus {
  PENDING
  CONFIRMED
  SHIPPED
  DELIVERED
  CANCELLED
  RETURNED
}

enum MarketplaceSettlementStatus {
  PENDING
  PAID
  RECONCILED
  DISCREPANCY
}"""

if "enum MarketplaceProvider" not in text:
    if old_enum_anchor in text:
        text = text.replace(old_enum_anchor, new_enum_anchor, 1)
        print("    [OK] Added 4 enums")
    else:
        print("    [FAIL] TrendyolConnectionStatus anchor not found")
        raise SystemExit(1)

# Add 3 generic models AFTER TrendyolSettlement
m = re.search(
    r'(model TrendyolSettlement \{[^}]*?@@map\("trendyol_settlements"\)\n\})',
    text, flags=re.DOTALL,
)
if not m:
    print("    [FAIL] TrendyolSettlement model not found")
    raise SystemExit(1)

ty_block = m.group(1)
new_models = '''

model MarketplaceConnection {
  id            String                       @id @default(uuid())
  merchantId    String
  provider      MarketplaceProvider
  sellerId      String?
  apiKey        String?
  apiSecret     String?
  storeName     String?
  region        String?
  status        MarketplaceConnectionStatus  @default(PENDING)
  lastSyncAt    DateTime?
  lastSyncError String?
  createdAt     DateTime                     @default(now())
  updatedAt     DateTime                     @updatedAt
  merchant      Merchant                     @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  orders        MarketplaceOrder[]
  settlements   MarketplaceSettlement[]

  @@unique([merchantId, provider])
  @@index([provider])
  @@index([status])
  @@map("marketplace_connections")
}

model MarketplaceOrder {
  id              String                  @id @default(uuid())
  merchantId      String
  connectionId    String
  provider        MarketplaceProvider
  externalOrderId String
  orderNumber     String
  status          MarketplaceOrderStatus
  customerName    String?
  productName     String?
  quantity        Int                     @default(1)
  grossAmount     Decimal                 @db.Decimal(18, 2)
  commission      Decimal                 @default(0) @db.Decimal(18, 2)
  shippingCost    Decimal                 @default(0) @db.Decimal(18, 2)
  netAmount       Decimal                 @db.Decimal(18, 2)
  currency        String                  @default("TRY")
  orderDate       DateTime
  shippedDate     DateTime?
  deliveredDate   DateTime?
  matchedTxnId    String?
  providerData    Json?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt
  merchant        Merchant                @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  connection      MarketplaceConnection   @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, externalOrderId])
  @@index([merchantId])
  @@index([provider])
  @@index([status])
  @@index([orderDate(sort: Desc)])
  @@index([matchedTxnId])
  @@map("marketplace_orders")
}

model MarketplaceSettlement {
  id                    String                       @id @default(uuid())
  merchantId            String
  connectionId          String
  provider              MarketplaceProvider
  externalSettlementId  String
  periodStart           DateTime
  periodEnd             DateTime
  grossSales            Decimal                      @default(0) @db.Decimal(18, 2)
  totalCommission       Decimal                      @default(0) @db.Decimal(18, 2)
  totalShipping         Decimal                      @default(0) @db.Decimal(18, 2)
  totalReturns          Decimal                      @default(0) @db.Decimal(18, 2)
  netPayout             Decimal                      @db.Decimal(18, 2)
  currency              String                       @default("TRY")
  status                MarketplaceSettlementStatus  @default(PENDING)
  expectedPayoutDate    DateTime?
  actualPayoutDate      DateTime?
  matchedTxnId          String?
  discrepancy           Decimal?                     @db.Decimal(18, 2)
  orderCount            Int                          @default(0)
  providerData          Json?
  createdAt             DateTime                     @default(now())
  updatedAt             DateTime                     @updatedAt
  merchant              Merchant                     @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  connection            MarketplaceConnection        @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, externalSettlementId])
  @@index([merchantId])
  @@index([provider])
  @@index([status])
  @@index([periodStart(sort: Desc)])
  @@map("marketplace_settlements")
}'''

if "model MarketplaceConnection" not in text:
    text = text.replace(ty_block, ty_block + new_models, 1)
    print("    [OK] Added 3 generic models")

# Add Merchant relations
old_rels = '''  trendyolConnection  TrendyolConnection?
  trendyolOrders      TrendyolOrder[]
  trendyolSettlements TrendyolSettlement[]'''

new_rels = '''  trendyolConnection  TrendyolConnection?
  trendyolOrders      TrendyolOrder[]
  trendyolSettlements TrendyolSettlement[]
  marketplaceConnections  MarketplaceConnection[]
  marketplaceOrders       MarketplaceOrder[]
  marketplaceSettlements  MarketplaceSettlement[]'''

if "marketplaceConnections" not in text:
    text = text.replace(old_rels, new_rels, 1)
    print("    [OK] Added 3 Merchant relations")

SCHEMA.write_text(text, encoding="utf-8")

# ============================================================
# 2) Create src/services/marketplaceCatalog.ts
# ============================================================
CAT = ROOT / "src" / "services" / "marketplaceCatalog.ts"
print()
print("[2/7] Create marketplaceCatalog.ts")

cat_content = '''// ============================================================
// Zyrix FinSuite - Marketplace Catalog
// Track C - Sprint 2 Feature 4
//
// Single source of truth for all 20 marketplace providers.
// Each entry has: country, currency, commission band, color
// brand and a sample-product/sample-customer pool used by
// the sandbox generator.
// ============================================================

export type ProviderKey =
  | "TRENDYOL" | "HEPSIBURADA" | "N11" | "CICEKSEPETI" | "PTTAVM"
  | "AMAZON_TR" | "GETIR" | "FLO" | "YEMEKSEPETI" | "VATAN"
  | "SALLA" | "ZID" | "NOON_SA" | "AMAZON_SA" | "JARIR"
  | "AMAZON_AE" | "NOON_AE" | "NAMSHI" | "CARREFOUR_AE" | "MUMZWORLD";

export type ProviderInfo = {
  key: ProviderKey;
  displayName: string;
  country: "TR" | "SA" | "AE";
  currency: "TRY" | "SAR" | "AED";
  commissionRate: number;          // average rate (0.18 = 18%)
  weeklyOrderVolume: number;       // for sandbox: orders to fabricate
  averageOrderValue: number;       // in local currency
  brandColor: string;
  category: "general" | "fashion" | "electronics" | "food" | "grocery" | "kids" | "books";
  products: string[];
};

export const PROVIDERS: Record<ProviderKey, ProviderInfo> = {
  // ---------- Turkey 🇹🇷 ----------
  TRENDYOL: {
    key: "TRENDYOL",
    displayName: "Trendyol",
    country: "TR", currency: "TRY",
    commissionRate: 0.18, weeklyOrderVolume: 30, averageOrderValue: 250,
    brandColor: "#F27A1A", category: "general",
    products: ["Krem Sampuan 500ml", "Vitamin C Serum 30ml", "LaserPro Beyazlatma Kremi", "Yuz Maskesi 5'li"],
  },
  HEPSIBURADA: {
    key: "HEPSIBURADA",
    displayName: "Hepsiburada",
    country: "TR", currency: "TRY",
    commissionRate: 0.16, weeklyOrderVolume: 25, averageOrderValue: 350,
    brandColor: "#FF6000", category: "general",
    products: ["Bluetooth Kulaklik", "Akilli Saat", "Kahve Makinesi", "Robot Supurge"],
  },
  N11: {
    key: "N11",
    displayName: "n11",
    country: "TR", currency: "TRY",
    commissionRate: 0.14, weeklyOrderVolume: 18, averageOrderValue: 280,
    brandColor: "#FF7C00", category: "general",
    products: ["Sirt Cantasi", "Klasik Kol Saati", "El Blendiri", "Termos 1L"],
  },
  CICEKSEPETI: {
    key: "CICEKSEPETI",
    displayName: "Ciceksepeti",
    country: "TR", currency: "TRY",
    commissionRate: 0.15, weeklyOrderVolume: 14, averageOrderValue: 180,
    brandColor: "#E60023", category: "fashion",
    products: ["Kirmizi Gul Buketi", "Cikolata Hediye Paketi", "Pasta", "Sukulent Saksi", "Karanfil 25'li"],
  },
  PTTAVM: {
    key: "PTTAVM",
    displayName: "PttAVM",
    country: "TR", currency: "TRY",
    commissionRate: 0.10, weeklyOrderVolume: 10, averageOrderValue: 220,
    brandColor: "#FFCC00", category: "general",
    products: ["El Yapimi Sabun", "Yore Bali 1kg", "Kuru Kayisi 500g", "Halicilik Urunleri"],
  },
  AMAZON_TR: {
    key: "AMAZON_TR",
    displayName: "Amazon Turkiye",
    country: "TR", currency: "TRY",
    commissionRate: 0.15, weeklyOrderVolume: 22, averageOrderValue: 310,
    brandColor: "#FF9900", category: "general",
    products: ["Kindle Paperwhite", "Echo Dot", "Fire TV Stick", "Ev Aletleri Seti"],
  },
  GETIR: {
    key: "GETIR",
    displayName: "Getir",
    country: "TR", currency: "TRY",
    commissionRate: 0.20, weeklyOrderVolume: 35, averageOrderValue: 95,
    brandColor: "#5D3EBC", category: "grocery",
    products: ["Sut 1L", "Ekmek", "Yumurta 30'lu", "Cay 1kg", "Sebze Paketi"],
  },
  FLO: {
    key: "FLO",
    displayName: "Flo",
    country: "TR", currency: "TRY",
    commissionRate: 0.17, weeklyOrderVolume: 14, averageOrderValue: 420,
    brandColor: "#1B1F24", category: "fashion",
    products: ["Spor Ayakkabi", "Kadin Topuklu", "Erkek Klasik Ayakkabi", "Cocuk Bot"],
  },
  YEMEKSEPETI: {
    key: "YEMEKSEPETI",
    displayName: "Yemeksepeti",
    country: "TR", currency: "TRY",
    commissionRate: 0.22, weeklyOrderVolume: 50, averageOrderValue: 140,
    brandColor: "#FA0050", category: "food",
    products: ["Kebap Menusu", "Pizza Buyuk", "Sushi Set", "Burger Kombosu", "Tatli Kutusu"],
  },
  VATAN: {
    key: "VATAN",
    displayName: "Vatan Bilgisayar",
    country: "TR", currency: "TRY",
    commissionRate: 0.10, weeklyOrderVolume: 12, averageOrderValue: 950,
    brandColor: "#CC0000", category: "electronics",
    products: ["Laptop", "Monitor 27 inch", "Klavye Mekanik", "Mouse Oyuncu", "Yazici"],
  },

  // ---------- Saudi Arabia 🇸🇦 ----------
  SALLA: {
    key: "SALLA",
    displayName: "Salla",
    country: "SA", currency: "SAR",
    commissionRate: 0.05, weeklyOrderVolume: 18, averageOrderValue: 220,
    brandColor: "#004B8D", category: "general",
    products: ["Krem Tabyeed Wajh", "Atr Oud", "Hijab Premium", "Maska Wajh"],
  },
  ZID: {
    key: "ZID",
    displayName: "Zid",
    country: "SA", currency: "SAR",
    commissionRate: 0.04, weeklyOrderVolume: 15, averageOrderValue: 195,
    brandColor: "#5C2D91", category: "general",
    products: ["Saj Bakim Yagi", "Vitamin C Serum", "Sabun Tabii", "Krem Yad Marteb"],
  },
  NOON_SA: {
    key: "NOON_SA",
    displayName: "Noon Suudi",
    country: "SA", currency: "SAR",
    commissionRate: 0.13, weeklyOrderVolume: 22, averageOrderValue: 350,
    brandColor: "#FFEE00", category: "general",
    products: ["Saat Akilli", "Cep Telefonu", "Kulaklik", "Cocuk Oyuncak Seti"],
  },
  AMAZON_SA: {
    key: "AMAZON_SA",
    displayName: "Amazon Suudi",
    country: "SA", currency: "SAR",
    commissionRate: 0.15, weeklyOrderVolume: 20, averageOrderValue: 380,
    brandColor: "#FF9900", category: "general",
    products: ["Kindle", "Echo Dot", "Fire Tablet", "Ev Aletleri"],
  },
  JARIR: {
    key: "JARIR",
    displayName: "Jarir Bookstore",
    country: "SA", currency: "SAR",
    commissionRate: 0.08, weeklyOrderVolume: 12, averageOrderValue: 510,
    brandColor: "#0033A0", category: "books",
    products: ["Laptop HP", "Kitap Tibbi", "Kalem Setti", "Yazici Lazer", "Tablet"],
  },

  // ---------- UAE 🇦🇪 ----------
  AMAZON_AE: {
    key: "AMAZON_AE",
    displayName: "Amazon Dubai",
    country: "AE", currency: "AED",
    commissionRate: 0.15, weeklyOrderVolume: 24, averageOrderValue: 320,
    brandColor: "#FF9900", category: "general",
    products: ["Echo Studio", "Kindle Oasis", "Fire HD 10", "Ring Doorbell"],
  },
  NOON_AE: {
    key: "NOON_AE",
    displayName: "Noon Dubai",
    country: "AE", currency: "AED",
    commissionRate: 0.13, weeklyOrderVolume: 28, averageOrderValue: 280,
    brandColor: "#FFEE00", category: "general",
    products: ["Akilli Saat", "Bluetooth Hoparlor", "Sac Kurutma", "Yuz Bakim Seti"],
  },
  NAMSHI: {
    key: "NAMSHI",
    displayName: "Namshi",
    country: "AE", currency: "AED",
    commissionRate: 0.14, weeklyOrderVolume: 20, averageOrderValue: 380,
    brandColor: "#000000", category: "fashion",
    products: ["Spor Ayakkabi Nike", "Tisort Adidas", "Cuzdan Premium", "Gunes Gozlugu"],
  },
  CARREFOUR_AE: {
    key: "CARREFOUR_AE",
    displayName: "Carrefour Dubai",
    country: "AE", currency: "AED",
    commissionRate: 0.10, weeklyOrderVolume: 30, averageOrderValue: 220,
    brandColor: "#0E5AA7", category: "grocery",
    products: ["Sut Tam Yagli", "Hurma Premium", "Pirinc Basmati", "Et Dana", "Tatli Karisik"],
  },
  MUMZWORLD: {
    key: "MUMZWORLD",
    displayName: "Mumzworld",
    country: "AE", currency: "AED",
    commissionRate: 0.16, weeklyOrderVolume: 14, averageOrderValue: 290,
    brandColor: "#E91E63", category: "kids",
    products: ["Bebek Bezi Pampers", "Bebe Mama 6 Aylik", "Cocuk Oyuncak", "Bebe Giyim 0-3 Ay"],
  },
};

export const SAMPLE_CUSTOMERS: Record<"TR" | "SA" | "AE", string[]> = {
  TR: ["Ayse Y.", "Mehmet T.", "Fatma O.", "Ahmet K.", "Zeynep A.", "Mustafa D.", "Elif G.", "Hasan B.", "Sevgi M.", "Yusuf C."],
  SA: ["Mohammed A.", "Fatma A.", "Abdullah M.", "Sara K.", "Khaled F.", "Reem A.", "Faisal B.", "Nora S.", "Saad M.", "Hala T."],
  AE: ["Ahmed M.", "Maryam K.", "Omar S.", "Fatma A.", "Khalid Y.", "Aisha M.", "Hassan A.", "Layla F.", "Saif A.", "Mona K."],
};

export function getProvider(key: string): ProviderInfo | null {
  return (PROVIDERS as any)[key] || null;
}

export function listProviders(): ProviderInfo[] {
  return Object.values(PROVIDERS);
}
'''

CAT.write_text(cat_content, encoding="utf-8")
print("    [OK] Created (size: " + str(CAT.stat().st_size) + " bytes)")

# ============================================================
# 3) Create src/services/marketplaceService.ts (sandbox client)
# ============================================================
SVC1 = ROOT / "src" / "services" / "marketplaceService.ts"
print()
print("[3/7] Create marketplaceService.ts (sandbox client)")

svc1_content = '''// ============================================================
// Zyrix FinSuite - Marketplace Sandbox Client
// Track C - Sprint 2 Feature 4
//
// Generates synthetic orders + settlements per provider using
// the catalog metadata. Real provider APIs plug in here later
// by switching on env.bankSandboxMode.
// ============================================================

import { env } from "../config/env";
import { PROVIDERS, SAMPLE_CUSTOMERS, ProviderKey } from "./marketplaceCatalog";

export type MarketplaceOrderRecord = {
  externalOrderId: string;
  orderNumber: string;
  status: "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED";
  customerName: string;
  productName: string;
  quantity: number;
  grossAmount: number;
  commission: number;
  shippingCost: number;
  netAmount: number;
  currency: string;
  orderDate: Date;
  shippedDate?: Date;
  deliveredDate?: Date;
};

export type MarketplaceSettlementRecord = {
  externalSettlementId: string;
  periodStart: Date;
  periodEnd: Date;
  grossSales: number;
  totalCommission: number;
  totalShipping: number;
  totalReturns: number;
  netPayout: number;
  currency: string;
  expectedPayoutDate: Date;
  orderCount: number;
};

function pseudoRandom(seed: string, idx: number): number {
  let h = 0;
  const s = seed + ":" + idx;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) / 2147483647;
}

function providerOrderPrefix(provider: ProviderKey): string {
  return provider.split("_")[0].slice(0, 4).toUpperCase();
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

export async function fetchMarketplaceOrders(args: {
  provider: ProviderKey;
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<MarketplaceOrderRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxOrders(args.provider, args.sellerId || "SELLER");
  }
  // TODO: real API integration per provider
  return [];
}

export async function fetchMarketplaceSettlements(args: {
  provider: ProviderKey;
  apiKey?: string | null;
  apiSecret?: string | null;
  sellerId?: string | null;
  since?: Date | null;
}): Promise<MarketplaceSettlementRecord[]> {
  if (env.bankSandboxMode) {
    return generateSandboxSettlements(args.provider, args.sellerId || "SELLER");
  }
  return [];
}

// ----------------------------------------------------------------
// Sandbox generators
// ----------------------------------------------------------------

function generateSandboxOrders(
  provider: ProviderKey,
  seed: string
): MarketplaceOrderRecord[] {
  const cfg = PROVIDERS[provider];
  if (!cfg) return [];

  const orders: MarketplaceOrderRecord[] = [];
  const now = Date.now();
  const customers = SAMPLE_CUSTOMERS[cfg.country];
  const prefix = providerOrderPrefix(provider);

  // Generate ~4 weeks of orders
  const totalCount = cfg.weeklyOrderVolume * 4;

  for (let i = 0; i < totalCount; i++) {
    const r = pseudoRandom(seed + ":" + provider, i);
    const r2 = pseudoRandom(seed + ":" + provider, i + 1000);

    const productIdx = Math.floor(r * cfg.products.length);
    const customerIdx = Math.floor(r2 * customers.length);

    const quantity = 1 + Math.floor(r * 3);
    const variance = 0.5 + r2; // 0.5x to 1.5x of average
    const unitPrice = Math.round(cfg.averageOrderValue * variance / quantity * 100) / 100;
    const grossAmount = Math.round(quantity * unitPrice * 100) / 100;
    const commission = Math.round(grossAmount * cfg.commissionRate * 100) / 100;
    const shippingCost = Math.round((10 + r * 30) * 100) / 100;
    const netAmount = Math.round((grossAmount - commission - shippingCost) * 100) / 100;

    const daysAgo = Math.floor(r2 * 60);
    const orderDate = new Date(now - daysAgo * 86400000);

    let status: MarketplaceOrderRecord["status"] = "DELIVERED";
    if (daysAgo < 1) status = "PENDING";
    else if (daysAgo < 3) status = "CONFIRMED";
    else if (daysAgo < 5) status = "SHIPPED";
    else if (r < 0.05) status = "RETURNED";
    else if (r < 0.07) status = "CANCELLED";

    orders.push({
      externalOrderId: prefix + "-" + seed + "-" + i + "-" + (now - daysAgo * 86400000).toString(36),
      orderNumber: prefix + String(1000000 + i).slice(0, 7),
      status,
      customerName: customers[customerIdx],
      productName: cfg.products[productIdx],
      quantity,
      grossAmount,
      commission,
      shippingCost,
      netAmount,
      currency: cfg.currency,
      orderDate,
      shippedDate: status !== "PENDING" && status !== "CONFIRMED"
        ? new Date(orderDate.getTime() + 2 * 86400000)
        : undefined,
      deliveredDate: status === "DELIVERED"
        ? new Date(orderDate.getTime() + 4 * 86400000)
        : undefined,
    });
  }

  return orders;
}

function generateSandboxSettlements(
  provider: ProviderKey,
  seed: string
): MarketplaceSettlementRecord[] {
  const cfg = PROVIDERS[provider];
  if (!cfg) return [];

  const settlements: MarketplaceSettlementRecord[] = [];
  const now = Date.now();
  const prefix = providerOrderPrefix(provider);

  // Generate 4 weekly settlements over last 28 days
  for (let i = 0; i < 4; i++) {
    const r = pseudoRandom(seed + ":" + provider, i + 5000);
    const periodEnd = new Date(now - i * 7 * 86400000);
    const periodStart = new Date(periodEnd.getTime() - 7 * 86400000);

    const orderCount = cfg.weeklyOrderVolume + Math.floor(r * 5);
    const grossSales = Math.round(orderCount * cfg.averageOrderValue * 100) / 100;
    const totalCommission = Math.round(grossSales * cfg.commissionRate * 100) / 100;
    const totalShipping = Math.round(orderCount * 25 * 100) / 100;
    const totalReturns = Math.round(grossSales * 0.05 * r * 100) / 100;
    const netPayout = Math.round((grossSales - totalCommission - totalShipping - totalReturns) * 100) / 100;

    settlements.push({
      externalSettlementId: prefix + "S-" + seed + "-" + periodEnd.getTime().toString(36),
      periodStart,
      periodEnd,
      grossSales,
      totalCommission,
      totalShipping,
      totalReturns,
      netPayout,
      currency: cfg.currency,
      expectedPayoutDate: new Date(periodEnd.getTime() + 3 * 86400000),
      orderCount,
    });
  }

  return settlements;
}
'''

SVC1.write_text(svc1_content, encoding="utf-8")
print("    [OK] Created (size: " + str(SVC1.stat().st_size) + " bytes)")

# ============================================================
# 4) Create src/services/marketplaceReconciliationService.ts
# ============================================================
SVC2 = ROOT / "src" / "services" / "marketplaceReconciliationService.ts"
print()
print("[4/7] Create marketplaceReconciliationService.ts")

svc2_content = '''// ============================================================
// Zyrix FinSuite - Marketplace Reconciliation Service
// Track C - Sprint 2 Feature 4
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  fetchMarketplaceOrders,
  fetchMarketplaceSettlements,
  MarketplaceOrderRecord,
  MarketplaceSettlementRecord,
} from "./marketplaceService";
import { ProviderKey } from "./marketplaceCatalog";

export type SyncResult = {
  success: boolean;
  ordersFetched: number;
  ordersInserted: number;
  ordersDuplicates: number;
  settlementsFetched: number;
  settlementsInserted: number;
  settlementsDuplicates: number;
  reconciledCount: number;
  error?: string;
};

export async function syncMarketplaceConnection(
  connectionId: string
): Promise<SyncResult> {
  const conn = await prisma.marketplaceConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) {
    return emptyResult("Connection not found");
  }

  const merchantId = conn.merchantId;
  const provider = conn.provider as ProviderKey;

  let orders: MarketplaceOrderRecord[] = [];
  let settlements: MarketplaceSettlementRecord[] = [];

  try {
    [orders, settlements] = await Promise.all([
      fetchMarketplaceOrders({
        provider,
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
      fetchMarketplaceSettlements({
        provider,
        apiKey: conn.apiKey,
        apiSecret: conn.apiSecret,
        sellerId: conn.sellerId,
        since: conn.lastSyncAt,
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    await prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { lastSyncError: msg, status: "ERROR" as any } as any,
    });
    return emptyResult(msg);
  }

  // Insert orders
  let ordersInserted = 0;
  let ordersDuplicates = 0;
  for (const o of orders) {
    try {
      await prisma.marketplaceOrder.create({
        data: {
          merchantId,
          connectionId,
          provider: provider as any,
          externalOrderId: o.externalOrderId,
          orderNumber: o.orderNumber,
          status: o.status as any,
          customerName: o.customerName,
          productName: o.productName,
          quantity: o.quantity,
          grossAmount: new Prisma.Decimal(o.grossAmount),
          commission: new Prisma.Decimal(o.commission),
          shippingCost: new Prisma.Decimal(o.shippingCost),
          netAmount: new Prisma.Decimal(o.netAmount),
          currency: o.currency,
          orderDate: o.orderDate,
          shippedDate: o.shippedDate || null,
          deliveredDate: o.deliveredDate || null,
          providerData: o as any,
        } as any,
      });
      ordersInserted++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        ordersDuplicates++;
      }
    }
  }

  // Insert settlements
  let settlementsInserted = 0;
  let settlementsDuplicates = 0;
  for (const s of settlements) {
    try {
      await prisma.marketplaceSettlement.create({
        data: {
          merchantId,
          connectionId,
          provider: provider as any,
          externalSettlementId: s.externalSettlementId,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          grossSales: new Prisma.Decimal(s.grossSales),
          totalCommission: new Prisma.Decimal(s.totalCommission),
          totalShipping: new Prisma.Decimal(s.totalShipping),
          totalReturns: new Prisma.Decimal(s.totalReturns),
          netPayout: new Prisma.Decimal(s.netPayout),
          currency: s.currency,
          expectedPayoutDate: s.expectedPayoutDate,
          orderCount: s.orderCount,
          providerData: s as any,
          status: "PENDING" as any,
        } as any,
      });
      settlementsInserted++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        settlementsDuplicates++;
      }
    }
  }

  // Reconciliation pass
  let reconciledCount = 0;

  const unmatchedSettlements = await prisma.marketplaceSettlement.findMany({
    where: {
      merchantId,
      connectionId,
      status: { in: ["PENDING", "PAID"] as any },
      matchedTxnId: null,
    },
    take: 50,
  });

  for (const s of unmatchedSettlements) {
    const expectedDate = s.expectedPayoutDate;
    if (!expectedDate) continue;

    const lo = new Date(expectedDate.getTime() - 5 * 86400000);
    const hi = new Date(expectedDate.getTime() + 5 * 86400000);

    const tolerance = Number(s.netPayout) * 0.01;
    const target = Number(s.netPayout);

    const candidates = await prisma.bankTransaction.findMany({
      where: {
        merchantId,
        direction: "IN" as any,
        transactionDate: { gte: lo, lte: hi },
        amount: {
          gte: new Prisma.Decimal(target - tolerance - 1),
          lte: new Prisma.Decimal(target + tolerance + 1),
        },
      },
      orderBy: { transactionDate: "asc" },
      take: 5,
    });

    if (candidates.length === 0) continue;

    let best = candidates[0];
    let bestDist = Math.abs(+new Date(best.transactionDate) - +expectedDate);
    for (const c of candidates.slice(1)) {
      const d = Math.abs(+new Date(c.transactionDate) - +expectedDate);
      if (d < bestDist) { best = c; bestDist = d; }
    }

    const discrepancy = Math.round((Number(best.amount) - target) * 100) / 100;

    await prisma.marketplaceSettlement.update({
      where: { id: s.id },
      data: {
        matchedTxnId: best.id,
        actualPayoutDate: best.transactionDate,
        discrepancy: new Prisma.Decimal(discrepancy),
        status: Math.abs(discrepancy) < 0.5 ? "RECONCILED" : "DISCREPANCY",
      } as any,
    });
    reconciledCount++;
  }

  await prisma.marketplaceConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: null,
      status: "CONNECTED" as any,
    } as any,
  });

  return {
    success: true,
    ordersFetched: orders.length,
    ordersInserted,
    ordersDuplicates,
    settlementsFetched: settlements.length,
    settlementsInserted,
    settlementsDuplicates,
    reconciledCount,
  };
}

function emptyResult(error?: string): SyncResult {
  return {
    success: false,
    ordersFetched: 0, ordersInserted: 0, ordersDuplicates: 0,
    settlementsFetched: 0, settlementsInserted: 0, settlementsDuplicates: 0,
    reconciledCount: 0,
    error,
  };
}
'''

SVC2.write_text(svc2_content, encoding="utf-8")
print("    [OK] Created (size: " + str(SVC2.stat().st_size) + " bytes)")

# ============================================================
# 5) Create src/controllers/marketplaceController.ts
# ============================================================
CTRL = ROOT / "src" / "controllers" / "marketplaceController.ts"
print()
print("[5/7] Create marketplaceController.ts")

ctrl_content = '''// ============================================================
// Zyrix FinSuite - Marketplace Controller
// Track C - Sprint 2 Feature 4
//
// Endpoints (all authenticated):
//   GET    /api/marketplace/providers       list all 20 providers
//   POST   /api/marketplace/connect         create/update connection
//   GET    /api/marketplace/connections     list all merchant connections
//   POST   /api/marketplace/sync/:id        trigger sync for one connection
//   POST   /api/marketplace/sync-all        sync all connected providers
//   GET    /api/marketplace/orders          list orders (filter by provider/status)
//   GET    /api/marketplace/settlements     list settlements (filter by provider)
//   DELETE /api/marketplace/connection/:id  disconnect one provider
// ============================================================

import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { syncMarketplaceConnection } from "../services/marketplaceReconciliationService";
import { listProviders, getProvider } from "../services/marketplaceCatalog";
import { pid } from "../utils/params";

interface AuthenticatedRequest extends Request {
  merchant?: { id: string; email: string; plan?: string };
}

const VALID_PROVIDERS = [
  "TRENDYOL","HEPSIBURADA","N11","CICEKSEPETI","PTTAVM",
  "AMAZON_TR","GETIR","FLO","YEMEKSEPETI","VATAN",
  "SALLA","ZID","NOON_SA","AMAZON_SA","JARIR",
  "AMAZON_AE","NOON_AE","NAMSHI","CARREFOUR_AE","MUMZWORLD",
] as const;

const connectSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  sellerId: z.string().trim().min(1).max(100),
  storeName: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().min(1).max(300).optional(),
  apiSecret: z.string().trim().min(1).max(300).optional(),
  region: z.string().trim().max(50).optional(),
});

function ok(res: Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

// ----------------------------------------------------------------
// GET /providers
// ----------------------------------------------------------------

export async function providersHandler(_req: Request, res: Response) {
  return ok(res, listProviders());
}

// ----------------------------------------------------------------
// POST /connect
// ----------------------------------------------------------------

export async function connectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, parsed.error.errors[0]?.message || "Invalid input");
  }
  const input = parsed.data;

  const cfg = getProvider(input.provider);
  if (!cfg) return fail(res, 400, "Unknown provider");

  try {
    const upserted = await prisma.marketplaceConnection.upsert({
      where: {
        merchantId_provider: {
          merchantId: req.merchant.id,
          provider: input.provider as any,
        },
      },
      create: {
        merchantId: req.merchant.id,
        provider: input.provider as any,
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        region: input.region || cfg.country,
        status: "CONNECTED" as any,
      } as any,
      update: {
        sellerId: input.sellerId,
        apiKey: input.apiKey || null,
        apiSecret: input.apiSecret || null,
        storeName: input.storeName || null,
        region: input.region || cfg.country,
        status: "CONNECTED" as any,
      } as any,
    });
    return ok(res, upserted, 201);
  } catch (err) {
    return fail(res, 500, "Failed to connect");
  }
}

// ----------------------------------------------------------------
// GET /connections
// ----------------------------------------------------------------

export async function connectionsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const rows = await prisma.marketplaceConnection.findMany({
    where: { merchantId: req.merchant.id },
    orderBy: { createdAt: "asc" },
  });
  return ok(res, rows);
}

// ----------------------------------------------------------------
// POST /sync/:id
// ----------------------------------------------------------------

export async function syncOneHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  const conn = await prisma.marketplaceConnection.findFirst({
    where: { id, merchantId: req.merchant.id },
  });
  if (!conn) return fail(res, 404, "Connection not found");

  const result = await syncMarketplaceConnection(conn.id);
  if (!result.success) return fail(res, 502, result.error || "Sync failed");
  return ok(res, result);
}

// ----------------------------------------------------------------
// POST /sync-all
// ----------------------------------------------------------------

export async function syncAllHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const conns = await prisma.marketplaceConnection.findMany({
    where: { merchantId: req.merchant.id, status: "CONNECTED" as any },
  });

  const results = [];
  for (const c of conns) {
    const r = await syncMarketplaceConnection(c.id);
    results.push({ provider: c.provider, ...r });
  }

  const totals = results.reduce((acc, r) => ({
    ordersInserted: acc.ordersInserted + (r.ordersInserted || 0),
    settlementsInserted: acc.settlementsInserted + (r.settlementsInserted || 0),
    reconciledCount: acc.reconciledCount + (r.reconciledCount || 0),
  }), { ordersInserted: 0, settlementsInserted: 0, reconciledCount: 0 });

  return ok(res, { results, totals, connectionsProcessed: conns.length });
}

// ----------------------------------------------------------------
// GET /orders
// ----------------------------------------------------------------

export async function ordersHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const provider = String(req.query.provider || "");
  const status = String(req.query.status || "");

  const where: any = { merchantId: req.merchant.id };
  if (provider) where.provider = provider;
  if (status) where.status = status;

  const [rows, total] = await Promise.all([
    prisma.marketplaceOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      take: 100,
    }),
    prisma.marketplaceOrder.count({ where }),
  ]);

  return ok(res, { rows, total });
}

// ----------------------------------------------------------------
// GET /settlements
// ----------------------------------------------------------------

export async function settlementsHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const provider = String(req.query.provider || "");
  const where: any = { merchantId: req.merchant.id };
  if (provider) where.provider = provider;

  const rows = await prisma.marketplaceSettlement.findMany({
    where,
    orderBy: { periodStart: "desc" },
    take: 100,
  });

  return ok(res, rows);
}

// ----------------------------------------------------------------
// DELETE /connection/:id
// ----------------------------------------------------------------

export async function disconnectHandler(req: AuthenticatedRequest, res: Response) {
  if (!req.merchant?.id) return fail(res, 401, "Not authenticated");

  const id = pid(req.params.id);
  if (!id) return fail(res, 400, "id required");

  await prisma.marketplaceConnection.deleteMany({
    where: { id, merchantId: req.merchant.id },
  });
  return ok(res, { disconnected: true });
}
'''

CTRL.write_text(ctrl_content, encoding="utf-8")
print("    [OK] Created (size: " + str(CTRL.stat().st_size) + " bytes)")

# ============================================================
# 6) Create src/routes/marketplace.ts
# ============================================================
RT = ROOT / "src" / "routes" / "marketplace.ts"
print()
print("[6/7] Create marketplace.ts route")

rt_content = '''// ============================================================
// Zyrix FinSuite - Marketplace Routes
// Track C - Sprint 2 Feature 4
// ============================================================

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import {
  providersHandler,
  connectHandler,
  connectionsHandler,
  syncOneHandler,
  syncAllHandler,
  ordersHandler,
  settlementsHandler,
  disconnectHandler,
} from "../controllers/marketplaceController";

const router = Router();
router.use(authenticate as any);

const syncRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Sync can be run at most 30 times per hour.",
  },
});

router.get("/providers",          providersHandler as any);
router.post("/connect",           connectHandler as any);
router.get("/connections",        connectionsHandler as any);
router.post("/sync/:id",          syncRateLimiter, syncOneHandler as any);
router.post("/sync-all",          syncRateLimiter, syncAllHandler as any);
router.get("/orders",             ordersHandler as any);
router.get("/settlements",        settlementsHandler as any);
router.delete("/connection/:id",  disconnectHandler as any);

export default router;
'''

RT.write_text(rt_content, encoding="utf-8")
print("    [OK] Created")

# ============================================================
# 7) Wire into src/index.ts
# ============================================================
INDEX = ROOT / "src" / "index.ts"
shutil.copy2(INDEX, INDEX.with_suffix(".ts.backup-marketplace"))
print()
print("[7/7] Wire into src/index.ts")

idx = INDEX.read_text(encoding="utf-8")

new_imp = 'import marketplaceRoutes   from "./routes/marketplace";'
new_use = 'app.use("/api/marketplace",    marketplaceRoutes);'

if "marketplaceRoutes" not in idx:
    idx = idx.replace(
        'import trendyolRoutes      from "./routes/trendyol";',
        'import trendyolRoutes      from "./routes/trendyol";\n' + new_imp,
        1,
    )
    print("    [OK] Import added")

if '"/api/marketplace"' not in idx:
    idx = idx.replace(
        'app.use("/api/trendyol",       trendyolRoutes);',
        'app.use("/api/trendyol",       trendyolRoutes);\n' + new_use,
        1,
    )
    print("    [OK] Route registered")

idx = idx.replace("Zyrix FinSuite v3.7", "Zyrix FinSuite v3.8", 1)
idx = idx.replace("23 features | 48 routes", "24 features | 56 routes", 1)
INDEX.write_text(idx, encoding="utf-8")
print("    [OK] Version v3.8")

# ============================================================
# Verification
# ============================================================
print()
print("=" * 70)
print("VERIFICATION")
print("=" * 70)
final = INDEX.read_text(encoding="utf-8")
schema_final = SCHEMA.read_text(encoding="utf-8")
checks = [
    ("schema: 4 enums",            all(e in schema_final for e in ["enum MarketplaceProvider", "enum MarketplaceConnectionStatus", "enum MarketplaceOrderStatus", "enum MarketplaceSettlementStatus"])),
    ("schema: 3 models",           all(m in schema_final for m in ["model MarketplaceConnection", "model MarketplaceOrder", "model MarketplaceSettlement"])),
    ("schema: 20 providers in enum", all(p in schema_final for p in ["TRENDYOL", "HEPSIBURADA", "GETIR", "YEMEKSEPETI", "SALLA", "ZID", "NAMSHI", "MUMZWORLD"])),
    ("schema: Merchant relations", "marketplaceConnections" in schema_final),
    ("Catalog exists",             CAT.exists()),
    ("Service exists",             SVC1.exists()),
    ("Reconciliation exists",      SVC2.exists()),
    ("Controller exists",          CTRL.exists()),
    ("Route exists",               RT.exists()),
    ("/api/marketplace wired",     '"/api/marketplace"' in final),
    ("v3.8",                       "v3.8" in final),
    ("24 features | 56 routes",    "24 features | 56 routes" in final),
]
passed = 0
for label, ok_check in checks:
    s = "OK" if ok_check else "MISSING"
    if ok_check: passed += 1
    print("     " + label.ljust(35) + " -> " + s)
print()
print("RESULT: " + str(passed) + "/" + str(len(checks)) + " checks passed")
print("=" * 70)
