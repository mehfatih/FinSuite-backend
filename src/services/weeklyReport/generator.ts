// ================================================================
// Sprint D-6 — Weekly report generator service.
//
// Orchestrates: weeklyKpis snapshot → insight pull → narrative
// composition → upsert WeeklyReport row.
//
// PDF rendering happens at delivery time, NOT here (decision §6.B
// option B1 — no blob storage in V1; PDF is regenerated on demand
// from the persisted snapshot + narrative + insightIds).
//
// Idempotent — the @@unique([merchantId, weekStart]) constraint
// means re-calling with the same weekStart is a no-op upsert that
// preserves the existing narrative unless force=true.
// ================================================================
import { prisma } from "../../config/database";
import { buildWeeklySnapshot, WeeklySnapshot } from "./weeklyKpis";
import { composeNarrative } from "./narrative";

const FALLBACK_NARRATIVE_TR =
  "Bu hafta için detaylı yorum hazırlanamadı. Aşağıdaki KPI'lar ve içgörüler haftayı özetliyor.";

export interface GenerateArgs {
  merchantId:  string;
  weekStart:   Date;          // Monday 00:00 (caller computes from merchant tz)
  weekEnd:     Date;          // Next Monday 00:00 — exclusive
  language?:   "tr" | "en" | "ar";
  currency?:   string;
  force?:      boolean;       // re-prompt narrative even if row exists
}

export interface GenerateResult {
  reportId:    string;
  snapshot:    WeeklySnapshot;
  narrative:   string;
  insightIds:  string[];
  reused:      boolean;       // true when an existing row was reused (no Gemini call)
}

export async function generateWeeklyReport(args: GenerateArgs): Promise<GenerateResult> {
  const { merchantId, weekStart, weekEnd, force } = args;
  const language = args.language || "tr";

  // 1. Cache check — reuse the existing row unless force=true.
  const existing = await prisma.weeklyReport.findUnique({
    where: { merchantId_weekStart: { merchantId, weekStart } }
  }).catch(() => null);

  if (existing && !force) {
    return {
      reportId:   existing.id,
      snapshot:   existing.kpiSnapshot as unknown as WeeklySnapshot,
      narrative:  existing.narrative,
      insightIds: existing.insightIds,
      reused:     true
    };
  }

  // 2. Read merchant context (currency, language, createdAt).
  const merchant = await prisma.merchant.findUnique({
    where:  { id: merchantId },
    select: { currency: true, language: true, createdAt: true, name: true, businessName: true }
  });
  if (!merchant) {
    throw new Error(`merchant_not_found: ${merchantId}`);
  }
  const currency = args.currency
    || (merchant.currency as unknown as string)
    || "TRY";

  // 3. Build the weekly snapshot.
  const snapshot = await buildWeeklySnapshot({
    merchantId, prisma, weekStart, weekEnd,
    currency,
    merchantCreatedAt: merchant.createdAt
  });

  // 4. Pull insights generated within the week (most recent first; cap 3).
  const insightRows = await prisma.insight.findMany({
    where:   {
      merchantId,
      generatedAt: { gte: weekStart, lt: weekEnd },
      status:      { not: "ARCHIVED" }
    },
    orderBy: { generatedAt: "desc" },
    take:    3,
    select:  { id: true, type: true, title: true, body: true, ctaLabel: true, ctaRoute: true }
  }).catch(() => []);

  const insightIds = insightRows.map((r) => r.id);

  // 5. Compose narrative (B.3 wires the real Gemini call here).
  let narrative: string;
  try {
    narrative = await composeNarrative({
      snapshot,
      merchantName: merchant.businessName || merchant.name,
      insights:     insightRows.map((r) => ({
        type: String(r.type), title: r.title, body: r.body
      })),
      language
    });
    if (!narrative || narrative.length < 20) narrative = FALLBACK_NARRATIVE_TR;
  } catch (err: any) {
    console.error(`[weeklyReport/generator] composeNarrative failed for ${merchantId}:`, err?.message || err);
    narrative = FALLBACK_NARRATIVE_TR;
  }

  // 6. Upsert WeeklyReport row.
  const row = await prisma.weeklyReport.upsert({
    where: { merchantId_weekStart: { merchantId, weekStart } },
    update: {
      narrative,
      insightIds,
      kpiSnapshot: snapshot as unknown as object,
      language,
      status:      "ready",
      generatedAt: new Date()
    },
    create: {
      merchantId,
      weekStart,
      weekEnd,
      narrative,
      insightIds,
      kpiSnapshot: snapshot as unknown as object,
      language,
      status:      "ready"
    }
  });

  return { reportId: row.id, snapshot, narrative, insightIds, reused: false };
}
