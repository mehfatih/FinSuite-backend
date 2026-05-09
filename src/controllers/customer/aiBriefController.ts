// ================================================================
// Phase 15 — AI Co-Pilot daily brief controller.
// GET  /api/customer/dashboard/ai-brief?focus=&language=
// POST /api/customer/dashboard/ai-brief/refresh
// Generates the 3-card brief via Gemini, caches per-customer per-day in
// customer_daily_brief, expires at next 6am local. Falls back to canned
// content on any AI failure so the UI never breaks.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

const FOCUS_AREAS = ["all", "cash", "sales", "tax", "customers", "operations"];

const SYSTEM_PROMPT = (focus: string, language: string) => `Sen Zyrix FinSuite'in AI Co-Pilot'usun.
Türkiye/MENA pazarındaki bir KOBİ için günlük brifing üretiyorsun.
Odak alanı: ${focus}
Dil: ${language}

3 kart üreteceksin: critical, attention, opportunity.
Her kart için:
- title:       (max 6 kelime, kullanıcının dilinde, somut)
- description: (max 18 kelime, ne olduğunu ve neden önemli)
- actionLabel: (max 3 kelime, butonun üzerinde yazacak)
- actionRoute: (FinSuite içinde gidecek sayfa)

ROUTES (sadece bu listeden seç):
- /sales/invoices?filter=overdue   → gecikmiş faturalar
- /tax/calendar                    → vergi takvimi
- /customers                       → müşteri listesi
- /customers/score                 → müşteri sağlığı
- /predictions/cash                → nakit tahmini
- /predictions/churn               → churn analizi
- /risk/hidden-cash                → gizli para
- /risk/crisis                     → kriz uyarıları
- /einvoice/auto                   → otomatik faturalama
- /ai/cfo                          → AI CFO

CRITICAL kartı: en acil sorun (gecikmiş tahsilat, nakit krizi yakın, vergi ödenmemiş)
ATTENTION kartı: önemli ama acil değil (yaklaşan ödeme, müşteri risk artıyor)
OPPORTUNITY kartı: pozitif aksiyon (upsell şansı, hidden cash, otomasyon önerisi)

Hiç critical bulamazsan, critical kartını bu sabit içerikle döndür:
{ "title": "Bugün acil bir sorun yok", "description": "Uzun vadeli fırsatlara odaklan.", "actionLabel": "Tahminler", "actionRoute": "/predictions/cash" }

YANIT: Sadece JSON dön, başka hiçbir şey yazma.
{
  "criticalCard":    { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." },
  "attentionCard":   { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." },
  "opportunityCard": { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." }
}`;

const FALLBACK_BRIEF = {
  criticalCard: {
    title:       "Bugün acil bir sorun yok",
    description: "AI brifingi yakında hazır olacak.",
    actionLabel: "Tahminler",
    actionRoute: "/predictions/cash",
  },
  attentionCard: {
    title:       "Vergi takvimini kontrol et",
    description: "Yaklaşan ödemeler için planlama yap.",
    actionLabel: "Aç",
    actionRoute: "/tax/calendar",
  },
  opportunityCard: {
    title:       "Müşteri sağlığını incele",
    description: "Yüksek değerli müşteri portföyünü gözden geçir.",
    actionLabel: "Müşteriler",
    actionRoute: "/customers/score",
  },
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function callGemini(focus: string, language: string) {
  if (!genAI) return null;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await Promise.race([
      model.generateContent(SYSTEM_PROMPT(focus, language)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!result) return null;
    const text = (result as any).response?.text?.() || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed?.criticalCard || !parsed?.attentionCard || !parsed?.opportunityCard) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const aiBriefController = {
  // ── GET /ai-brief ────────────────────────────────────────────
  getBrief: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      const focus    = String(req.query.focus    || "all");
      const language = String(req.query.language || "tr");
      if (!FOCUS_AREAS.includes(focus)) {
        res.status(400).json({ success: false, error: "Invalid focus area." });
        return;
      }

      const briefDate = new Date(todayKey());

      // Try cache first.
      const cached = await prisma.customerDailyBrief.findFirst({
        where: { customerUserId: userId, briefDate },
      }).catch(() => null);

      if (cached && cached.expiresAt > new Date() && cached.focusArea === focus) {
        res.status(200).json({
          success: true,
          data: {
            brief: {
              criticalCard:    cached.criticalCard,
              attentionCard:   cached.attentionCard,
              opportunityCard: cached.opportunityCard,
              generatedAt:     cached.generatedAt,
              focusArea:       cached.focusArea,
            },
            cached: true,
          },
        });
        return;
      }

      // Generate via Gemini, fall back to canned content on any failure.
      const generated = await callGemini(focus, language);
      const brief = generated || FALLBACK_BRIEF;

      // Cache expires at next 6am local — brief regenerates every morning.
      const now = new Date();
      const next6am = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + (now.getHours() >= 6 ? 1 : 0),
        6, 0, 0
      );

      // Cache failures shouldn't block the response.
      await prisma.customerDailyBrief.upsert({
        where:  { customerUserId_briefDate: { customerUserId: userId, briefDate } },
        update: {
          criticalCard:    brief.criticalCard,
          attentionCard:   brief.attentionCard,
          opportunityCard: brief.opportunityCard,
          focusArea:       focus,
          generatedAt:     new Date(),
          expiresAt:       next6am,
        },
        create: {
          customerUserId:  userId,
          briefDate,
          criticalCard:    brief.criticalCard,
          attentionCard:   brief.attentionCard,
          opportunityCard: brief.opportunityCard,
          focusArea:       focus,
          expiresAt:       next6am,
        },
      }).catch(() => undefined);

      res.status(200).json({
        success: true,
        data: {
          brief: { ...brief, generatedAt: new Date(), focusArea: focus },
          cached:   false,
          fallback: !generated,
        },
      });
    } catch (err: any) {
      console.error("[customer/dashboard/ai-brief] error:", err?.message || err);
      // Never break the UI — always return a brief.
      res.status(200).json({
        success: true,
        data: {
          brief: { ...FALLBACK_BRIEF, generatedAt: new Date(), focusArea: "all" },
          cached:   false,
          fallback: true,
        },
      });
    }
  }),

  // ── POST /ai-brief/refresh ───────────────────────────────────
  refresh: h(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      // Drop today's cache entry so getBrief regenerates.
      await prisma.customerDailyBrief.deleteMany({
        where: { customerUserId: userId, briefDate: new Date(todayKey()) },
      }).catch(() => undefined);

      // Delegate to getBrief which will re-cache.
      await aiBriefController.getBrief(req, res, next);
    } catch (err: any) {
      console.error("[customer/dashboard/ai-brief/refresh] error:", err?.message || err);
      res.status(500).json({ success: false, error: err?.message || "Refresh failed" });
    }
  }),
};
