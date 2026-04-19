// ================================================================
// Zyrix FinSuite — BenchmarkAverage Seed Script
// بيانات متوسطات السوق التركي لعام 2026
// شغّله مرة واحدة: npx ts-node src/scripts/seedBenchmark.ts
// ================================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BENCHMARK_DATA = [
  // ── Genel (sektöre bakılmaksızın) ──────────────────────────
  {
    period: '2026-01', sector: null, province: null,
    avgRevenue: 85000, avgInvoiceValue: 4200,
    avgCollectionRate: 72.5, avgDaysToPay: 28, sampleSize: 0,
  },
  {
    period: '2026-02', sector: null, province: null,
    avgRevenue: 91000, avgInvoiceValue: 4350,
    avgCollectionRate: 71.8, avgDaysToPay: 29, sampleSize: 0,
  },
  {
    period: '2026-03', sector: null, province: null,
    avgRevenue: 96500, avgInvoiceValue: 4500,
    avgCollectionRate: 73.2, avgDaysToPay: 27, sampleSize: 0,
  },
  {
    period: '2026-04', sector: null, province: null,
    avgRevenue: 98000, avgInvoiceValue: 4600,
    avgCollectionRate: 74.0, avgDaysToPay: 26, sampleSize: 0,
  },

  // ── Perakende (Retail) ──────────────────────────────────────
  {
    period: '2026-04', sector: 'RETAIL', province: null,
    avgRevenue: 120000, avgInvoiceValue: 3200,
    avgCollectionRate: 68.0, avgDaysToPay: 20, sampleSize: 0,
  },
  {
    period: '2026-04', sector: 'RETAIL', province: 'Istanbul',
    avgRevenue: 180000, avgInvoiceValue: 4100,
    avgCollectionRate: 70.5, avgDaysToPay: 18, sampleSize: 0,
  },
  {
    period: '2026-04', sector: 'RETAIL', province: 'Ankara',
    avgRevenue: 95000, avgInvoiceValue: 2900,
    avgCollectionRate: 67.0, avgDaysToPay: 22, sampleSize: 0,
  },

  // ── Hizmet (Service) ────────────────────────────────────────
  {
    period: '2026-04', sector: 'SERVICE', province: null,
    avgRevenue: 75000, avgInvoiceValue: 8500,
    avgCollectionRate: 78.0, avgDaysToPay: 35, sampleSize: 0,
  },
  {
    period: '2026-04', sector: 'SERVICE', province: 'Istanbul',
    avgRevenue: 110000, avgInvoiceValue: 12000,
    avgCollectionRate: 80.5, avgDaysToPay: 32, sampleSize: 0,
  },

  // ── İnşaat (Construction) ───────────────────────────────────
  {
    period: '2026-04', sector: 'CONSTRUCTION', province: null,
    avgRevenue: 250000, avgInvoiceValue: 45000,
    avgCollectionRate: 60.0, avgDaysToPay: 55, sampleSize: 0,
  },

  // ── Teknoloji (Technology) ──────────────────────────────────
  {
    period: '2026-04', sector: 'TECHNOLOGY', province: null,
    avgRevenue: 95000, avgInvoiceValue: 15000,
    avgCollectionRate: 82.0, avgDaysToPay: 22, sampleSize: 0,
  },
  {
    period: '2026-04', sector: 'TECHNOLOGY', province: 'Istanbul',
    avgRevenue: 145000, avgInvoiceValue: 22000,
    avgCollectionRate: 85.0, avgDaysToPay: 20, sampleSize: 0,
  },

  // ── Yiyecek & İçecek (F&B) ─────────────────────────────────
  {
    period: '2026-04', sector: 'FNB', province: null,
    avgRevenue: 65000, avgInvoiceValue: 1800,
    avgCollectionRate: 65.0, avgDaysToPay: 14, sampleSize: 0,
  },

  // ── Sağlık (Healthcare) ─────────────────────────────────────
  {
    period: '2026-04', sector: 'HEALTHCARE', province: null,
    avgRevenue: 110000, avgInvoiceValue: 6500,
    avgCollectionRate: 76.0, avgDaysToPay: 30, sampleSize: 0,
  },

  // ── Eğitim (Education) ─────────────────────────────────────
  {
    period: '2026-04', sector: 'EDUCATION', province: null,
    avgRevenue: 55000, avgInvoiceValue: 5000,
    avgCollectionRate: 88.0, avgDaysToPay: 15, sampleSize: 0,
  },

  // ── Lojistik (Logistics) ────────────────────────────────────
  {
    period: '2026-04', sector: 'LOGISTICS', province: null,
    avgRevenue: 185000, avgInvoiceValue: 9500,
    avgCollectionRate: 70.0, avgDaysToPay: 40, sampleSize: 0,
  },
];

async function seed() {
  console.log('🌱 BenchmarkAverage seed başlıyor...');

  let created = 0, skipped = 0;

  for (const record of BENCHMARK_DATA) {
    try {
      await prisma.benchmarkAverage.upsert({
        where: {
          period_sector_province: {
            period:   record.period,
            sector:   record.sector,
            province: record.province,
          },
        },
        create: record,
        update: {
          avgRevenue:        record.avgRevenue,
          avgInvoiceValue:   record.avgInvoiceValue,
          avgCollectionRate: record.avgCollectionRate,
          avgDaysToPay:      record.avgDaysToPay,
        },
      });
      created++;
      console.log(`  ✅ ${record.period} | ${record.sector || 'Genel'} | ${record.province || 'Tüm Türkiye'}`);
    } catch (err) {
      console.error(`  ❌ Hata:`, err);
      skipped++;
    }
  }

  console.log(`\n✅ Tamamlandı: ${created} kayıt oluşturuldu/güncellendi, ${skipped} hatalı`);
  await prisma.$disconnect();
}

seed().catch(console.error);