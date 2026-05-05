// ============================================================
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
