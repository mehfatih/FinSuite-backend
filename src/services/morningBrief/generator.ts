// ================================================================
// Sprint D-5 — Morning brief content generator.
//
// Strategy (per Mehmet's decision 6.E):
//   1. Try the existing customer_daily_brief cache row for today.
//      In ~95% of ticks this hits because the merchant opened the
//      in-app dashboard at least once that day.
//   2. On cache miss, HTTP-loopback to the merchant's own
//      /api/customer/dashboard/ai-brief/refresh endpoint with a
//      short-lived JWT (5 min, scoped to id+email+plan to mirror
//      what authController.login() issues). That endpoint owns the
//      Gemini call and writes the cache row. We then re-read.
//
//   This keeps aiBriefController.ts and merchantSnapshot.ts
//   completely untouched (protected per the hard-rule list).
//
// Output: { subject, cards, kpis, insightIds, currency, language,
//           merchantName, briefDate, focusArea }
//   The renderer (B.4) takes this and produces HTML.
// ================================================================
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { buildMerchantSnapshot } from "../customer/merchantSnapshot";
import type { ScheduleMerchant } from "./scheduler";

const LOOPBACK_TIMEOUT_MS = 12_000;
const LOOPBACK_TOKEN_TTL  = "5m";

export type CardSeverity = "CRITICAL" | "ATTENTION" | "OPPORTUNITY";

export interface GeneratedCard {
  severity:    CardSeverity;
  title:       string;
  description: string;
  ctaLabel?:   string;
  ctaRoute?:   string;
}

export interface GeneratedBrief {
  subject:      string;
  preheader:    string;
  cards:        GeneratedCard[];        // up to 3, ordered critical→attention→opportunity
  kpis:         Record<string, number | null>;   // mrr, cash_balance, customer_health_pct, tax_burden, etc.
  insightIds:   string[];               // Insight rows that fed this brief
  currency:     string;
  language:     "tr" | "en" | "ar";
  merchantName: string;
  briefDate:    string;                 // "YYYY-MM-DD" in merchant's tz
  focusArea:    string;
  fromCache:    boolean;
}

const SUBJECT = {
  defaultTitle: {
    tr: "Bugün için 3 önemli içgörü",
    en: "3 insights for today",
    ar: "ثلاث رؤى مهمة لشركتك اليوم"
  },
  morningBrief: {
    tr: "Zyrix Sabah Brifingi",
    en: "Zyrix Morning Brief",
    ar: "إيجاز زيريكس الصباحي"
  },
  criticalPrefix: {
    tr: "🔴 Kritik:",
    en: "🔴 Critical:",
    ar: "🔴 حرج:"
  },
  greeting: {
    tr: "Günaydın",
    en: "Good morning",
    ar: "صباح الخير"
  }
} as const;

const PREHEADER = {
  tr: "Bugünün brifingi: 3 içgörü, KPI özeti ve günün tek aksiyonu.",
  en: "Today's brief: 3 insights, KPI snapshot, and one action for the day.",
  ar: "إيجاز اليوم: ثلاث رؤى وملخص المؤشرات وإجراء واحد لليوم."
} as const;

function localDateKey(tz: string, when: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  });
  // en-CA emits YYYY-MM-DD natively.
  return fmt.format(when);
}

function normalizeLanguage(raw: unknown): "tr" | "en" | "ar" {
  const v = String(raw || "").toLowerCase();
  if (v === "ar" || v === "en") return v;
  return "tr";
}

function buildSubject(args: {
  cards:        GeneratedCard[];
  language:     "tr" | "en" | "ar";
  merchantName: string;
}): string {
  const { cards, language, merchantName } = args;
  const critical = cards.find((c) => c.severity === "CRITICAL");
  // 50-char cap is a hard rule (mobile preview).
  const trimmed  = (s: string) => s.length > 50 ? s.slice(0, 47) + "…" : s;
  if (critical) {
    const subj = `${SUBJECT.criticalPrefix[language]} ${critical.title}`;
    return trimmed(subj);
  }
  const tail = merchantName ? ` • ${merchantName}` : ` • ${SUBJECT.morningBrief[language]}`;
  const subj = `${SUBJECT.defaultTitle[language]}${tail}`;
  return trimmed(subj);
}

/**
 * Mint a short-lived merchant JWT in the same shape authController.login()
 * issues. Used only by the loopback fallback. NEVER returned to clients.
 */
function mintLoopbackToken(merchant: { id: string; email: string }): string {
  return jwt.sign(
    { id: merchant.id, email: merchant.email, plan: "loopback" },
    env.jwtSecret,
    { expiresIn: LOOPBACK_TOKEN_TTL } as any
  );
}

async function loopbackRefresh(merchant: { id: string; email: string }, language: string): Promise<void> {
  const token = mintLoopbackToken(merchant);
  const url   = `http://127.0.0.1:${env.port}/api/customer/dashboard/ai-brief/refresh?focus=all&language=${encodeURIComponent(language)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOPBACK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal:  ctrl.signal
    });
    if (!res.ok) {
      console.error(`[morning-brief/loopback] refresh returned HTTP ${res.status} for merchant ${merchant.id}`);
    }
  } catch (err: any) {
    console.error(`[morning-brief/loopback] refresh failed for merchant ${merchant.id}:`, err?.message || err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read today's cached brief; loopback once on miss, then re-read.
 * Returns null if both attempts fail (caller falls back to a tiny
 * canned card set so the email still ships).
 */
async function fetchCachedBrief(args: {
  merchant: { id: string; email: string };
  language: string;
  briefDate: string;
}): Promise<{ criticalCard: any; attentionCard: any; opportunityCard: any; focusArea: string } | null> {
  const briefDateRow = new Date(args.briefDate);

  let row = await prisma.customerDailyBrief.findFirst({
    where: { customerUserId: args.merchant.id, briefDate: briefDateRow }
  }).catch(() => null);

  // expiresAt is "next 6 AM local"; if past, controller would regenerate
  // on its next call. For the digest we treat expired-today as "miss".
  const isFresh = (r: any) => r && r.expiresAt && new Date(r.expiresAt).getTime() > Date.now();

  if (!isFresh(row)) {
    await loopbackRefresh(args.merchant, args.language);
    row = await prisma.customerDailyBrief.findFirst({
      where: { customerUserId: args.merchant.id, briefDate: briefDateRow }
    }).catch(() => null);
  }

  if (!row) return null;
  return {
    criticalCard:    row.criticalCard,
    attentionCard:   row.attentionCard,
    opportunityCard: row.opportunityCard,
    focusArea:       row.focusArea
  };
}

const FALLBACK_CARDS: GeneratedCard[] = [
  { severity: "ATTENTION",   title: "Bugün için günlük brifing hazır",   description: "Panele dön ve günlük içgörülerine göz at.", ctaLabel: "Aç", ctaRoute: "/dashboard" },
  { severity: "OPPORTUNITY", title: "Müşteri sağlığını incele",          description: "Yüksek değerli müşteri portföyünü gözden geçir.", ctaLabel: "Müşteriler", ctaRoute: "/customers/score" }
];

function cardsFromCache(cache: { criticalCard: any; attentionCard: any; opportunityCard: any }): GeneratedCard[] {
  const slots: Array<{ key: keyof typeof cache; sev: CardSeverity }> = [
    { key: "criticalCard",    sev: "CRITICAL"    },
    { key: "attentionCard",   sev: "ATTENTION"   },
    { key: "opportunityCard", sev: "OPPORTUNITY" }
  ];
  const out: GeneratedCard[] = [];
  for (const { key, sev } of slots) {
    const c = cache[key];
    if (!c || typeof c !== "object" || !c.title) continue;
    out.push({
      severity:    sev,
      title:       String(c.title || "").slice(0, 120),
      description: String(c.description || "").slice(0, 240),
      ctaLabel:    c.actionLabel ? String(c.actionLabel) : undefined,
      ctaRoute:    c.actionRoute ? String(c.actionRoute) : undefined
    });
  }
  return out;
}

/**
 * Pull the Insight rows that match today's cards (best-effort —
 * powers the "insightIds" audit field on MorningBriefSend).
 */
async function recentInsightIds(merchantId: string): Promise<string[]> {
  try {
    const rows = await prisma.insight.findMany({
      where:   { merchantId, status: "ACTIVE" },
      orderBy: { generatedAt: "desc" },
      take:    3,
      select:  { id: true }
    });
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/** Public API — the only function the renderer / scheduler calls. */
export async function generateBrief(args: {
  merchant: ScheduleMerchant;
  nowArg?:  Date;
}): Promise<GeneratedBrief> {
  const now      = args.nowArg || new Date();
  const language = normalizeLanguage(args.merchant.language);
  const briefDate = localDateKey(args.merchant.timezone, now);

  const cache = await fetchCachedBrief({
    merchant:  { id: args.merchant.id, email: args.merchant.email },
    language,
    briefDate
  });

  let cards = cache ? cardsFromCache(cache) : [];
  let fromCache = !!cache;
  if (cards.length === 0) {
    cards = FALLBACK_CARDS;
    fromCache = false;
  }

  // KPI snapshot for the email mini-cards. merchantSnapshot.ts is a
  // protected file, but exporting buildMerchantSnapshot is its public
  // contract — we're calling it, not modifying it.
  let kpis: Record<string, number | null> = {};
  try {
    const snap = await buildMerchantSnapshot(args.merchant.id, prisma as any, language, "all", "TRY");
    kpis = snap.kpis as unknown as Record<string, number | null>;
  } catch (err: any) {
    console.error(`[morning-brief/generator] buildMerchantSnapshot failed for ${args.merchant.id}:`, err?.message || err);
  }

  const merchantName = args.merchant.businessName || args.merchant.name || "";
  const subject = buildSubject({ cards, language, merchantName });
  const insightIds = await recentInsightIds(args.merchant.id);

  return {
    subject,
    preheader:    PREHEADER[language],
    cards,
    kpis,
    insightIds,
    currency:     "TRY",
    language,
    merchantName,
    briefDate,
    focusArea:    cache?.focusArea || "all",
    fromCache
  };
}
