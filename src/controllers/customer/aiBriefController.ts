// ================================================================
// Phase 16 — AI Co-Pilot daily brief grounded in merchant data.
// GET  /api/customer/dashboard/ai-brief?focus=&language=
// POST /api/customer/dashboard/ai-brief/refresh
//
// Generates a 3-card brief via Gemini, prompted with the merchant's
// real KPI snapshot from kpiComputations.ts (so the AI's view ==
// the user's view). Routes returned by Gemini are validated against
// a fixed allowlist; bad shape or unknown route falls back to canned
// content. Cached per-customer per-day per-focus in customer_daily_brief
// (expires next 6am local). Refresh endpoint rate-limited to 1/60s
// per merchant to bound Gemini spend.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AuthenticatedRequest } from "../../types";
import { buildMerchantSnapshot, MerchantSnapshot } from "../../services/customer/merchantSnapshot";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;
console.log("[ai-brief] startup: GEMINI_API_KEY present:", !!env.geminiApiKey, "length:", (env.geminiApiKey || "").length);

const FOCUS_AREAS = ["all", "cash", "sales", "tax", "customers", "operations"];

// Fixed list of routes Gemini may suggest. Anything outside this gets
// rewritten via prefix-distance to the closest allowed route or /dashboard.
const ALLOWED_ROUTES = [
  "/dashboard",
  "/v2/dashboard",
  "/sales/invoices?filter=overdue",
  "/sales/invoices",
  "/tax/calendar",
  "/tax/autopilot",
  "/customers",
  "/customers/score",
  "/predictions/cash",
  "/predictions/churn",
  "/risk/hidden-cash",
  "/risk/crisis",
  "/einvoice/auto",
  "/ai/cfo",
  "/cash/bank-recon",
  "/cash/registers"
];

// Refresh rate limit — one fresh generation per merchant per 60 seconds.
const REFRESH_RATELIMIT_MS = 60_000;
const refreshLastAt = new Map<string, number>();

const FALLBACK_BRIEF = {
  criticalCard: {
    title:       "Bugün acil bir sorun yok",
    description: "Uzun vadeli fırsatlara odaklan.",
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

const next6am = (): Date => {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0);
  if (now.getHours() >= 6) target.setDate(target.getDate() + 1);
  return target;
};

const fmtCurrency = (n: number | null, code = "TRY"): string => {
  if (n === null || n === undefined) return "bilinmiyor";
  const sym = code === "TRY" ? "₺" : code === "USD" ? "$" : code === "SAR" ? "﷼ " : "";
  return `${sym}${Math.round(n).toLocaleString("tr-TR")}`;
};

const fmtPct  = (n: number | null) => (n === null || n === undefined) ? "bilinmiyor" : `${n.toFixed(1)}%`;
const fmtDays = (n: number | null) => (n === null || n === undefined) ? "bilinmiyor" : `${Math.round(n)} gün`;

// ─────────────────────────────────────────────────────────────
// Build a structured prompt that grounds Gemini in real numbers.
// ─────────────────────────────────────────────────────────────
function buildPrompt(snapshot: MerchantSnapshot): string {
  const k = snapshot.kpis;
  const lang  = snapshot.language;
  const focus = snapshot.focus;

  const dataLines: string[] = [];
  dataLines.push(`MRR (bu ay): ${fmtCurrency(k.mrr, snapshot.currency)}`);
  if (k.mrr_growth_pct !== null) dataLines.push(`MRR büyüme: ${fmtPct(k.mrr_growth_pct)} (geçen aya göre)`);
  if (k.cash_balance !== null)   dataLines.push(`Hazır nakit: ${fmtCurrency(k.cash_balance, snapshot.currency)}`);
  if (k.cash_runway_days !== null) dataLines.push(`Nakit ömrü: ${fmtDays(k.cash_runway_days)}`);
  if (k.overdue_receivables !== null && k.overdue_receivables > 0) dataLines.push(`Gecikmiş alacak: ${fmtCurrency(k.overdue_receivables, snapshot.currency)}`);
  if (k.payable_30d !== null && k.payable_30d > 0) dataLines.push(`30 günde ödenecek: ${fmtCurrency(k.payable_30d, snapshot.currency)}`);
  if (k.pending_invoices !== null && k.pending_invoices > 0) dataLines.push(`Bekleyen fatura: ${k.pending_invoices} adet`);
  if (k.new_customers_30d !== null) dataLines.push(`30 günde yeni müşteri: ${k.new_customers_30d}`);
  if (k.customer_health_pct !== null) dataLines.push(`Müşteri sağlığı: ${fmtPct(k.customer_health_pct)}`);
  if (k.top_customer_revenue !== null && k.top_customer_revenue > 0) dataLines.push(`En büyük müşteri geliri: ${fmtCurrency(k.top_customer_revenue, snapshot.currency)}`);
  if (k.tax_burden !== null && k.tax_burden > 0) dataLines.push(`Vergi yükü (yaklaşan): ${fmtCurrency(k.tax_burden, snapshot.currency)}`);

  const noData = !snapshot.context.has_data;

  return `Sen Zyrix FinSuite'in AI Co-Pilot'usun. Türkiye/MENA pazarındaki bir KOBİ için günlük brifing üretiyorsun.

İŞLETME VERİSİ (gerçek sayılar):
${dataLines.join("\n")}

Bağlam:
- Son 30 günde ${snapshot.context.invoice_count_30d} fatura kesilmiş
- ${snapshot.context.customer_count} kayıtlı müşteri var
- Odak alanı: ${focus}
- Yanıt dili: ${lang}
${noData ? "- ⚠️ Bu işletmenin henüz yeterli verisi yok — onboarding tonunda yaz" : ""}

GÖREV:
3 kart üreteceksin. Her kart spesifik bir sayıya bağlı olmalı, genel tavsiye olmamalı.

KART 1 — KRİTİK (en acil sorun):
- Gerçek bir kriz var mı? (cash_runway < 30, overdue > 50K, churn risk yüksek)
- Eğer yoksa: "Bugün acil bir sorun yok — uzun vadeli fırsata bak" formatında pozitif kart

KART 2 — DİKKAT (önemli ama acil değil):
- Yaklaşan ödemeler, müşteri risk artışı, vergi tarihi yakın

KART 3 — FIRSAT (pozitif aksiyon):
- Upsell şansı, otomasyon önerisi, hidden cash, müşteri sağlığı yüksek

HER KART İÇİN:
- title:       ${lang === "tr" ? "Türkçe, max 8 kelime, somut sayı içerebilir" : "Same constraints in " + lang}
- description: max 22 kelime, neden önemli ve hangi sayıya bağlı
- actionLabel: max 3 kelime
- actionRoute: AŞAĞIDAKİ LİSTEDEN BİR YOL SEÇ

İZİNLİ ROUTES (sadece bu listeden seç, başka yol uydurma):
${ALLOWED_ROUTES.join("\n")}

YANIT FORMATI: Sadece JSON döndür, başka hiçbir şey yazma:
{
  "criticalCard":    { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." },
  "attentionCard":   { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." },
  "opportunityCard": { "title": "...", "description": "...", "actionLabel": "...", "actionRoute": "..." }
}`;
}

// ─────────────────────────────────────────────────────────────
// Validate Gemini's parsed JSON shape; rewrite hallucinated routes.
// Returns the sanitized brief, or null on bad shape.
// ─────────────────────────────────────────────────────────────
function sanitizeBrief(parsed: any): any | null {
  if (!parsed || typeof parsed !== "object") return null;
  const cards = ["criticalCard", "attentionCard", "opportunityCard"];
  const out: any = {};
  for (const key of cards) {
    const c = parsed[key];
    if (!c || typeof c !== "object") return null;
    const title       = String(c.title       || "").slice(0, 80).trim();
    const description = String(c.description || "").slice(0, 200).trim();
    const actionLabel = String(c.actionLabel || "Aç").slice(0, 24).trim();
    let   actionRoute = String(c.actionRoute || "/dashboard").trim();
    if (!ALLOWED_ROUTES.includes(actionRoute)) {
      actionRoute = closestAllowed(actionRoute);
    }
    if (!title || !description) return null;
    out[key] = { title, description, actionLabel, actionRoute };
  }
  return out;
}

function closestAllowed(route: string): string {
  let best = "/dashboard";
  let bestScore = 0;
  for (const allowed of ALLOWED_ROUTES) {
    let i = 0;
    while (i < route.length && i < allowed.length && route[i] === allowed[i]) i++;
    if (i > bestScore) { bestScore = i; best = allowed; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────
// Gemini call with 8s timeout.
// ─────────────────────────────────────────────────────────────
async function callGemini(snapshot: MerchantSnapshot): Promise<any | null> {
  if (!genAI) {
    console.error("[ai-brief] callGemini: genAI is null — GEMINI_API_KEY missing at boot");
    return null;
  }
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = buildPrompt(snapshot);

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!result) {
      console.error("[ai-brief] callGemini: timeout or null result from Gemini (>8s or race resolved null)");
      return null;
    }

    const text = (result as any).response?.text?.() || "";
    if (!text) {
      console.error("[ai-brief] callGemini: empty text from Gemini response");
      return null;
    }
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr: any) {
      console.error("[ai-brief] callGemini: JSON.parse failed:", parseErr?.message, "cleaned text:", cleaned.slice(0, 500));
      return null;
    }
    const sanitized = sanitizeBrief(parsed);
    if (!sanitized) {
      console.error("[ai-brief] callGemini: sanitizeBrief rejected shape. Parsed:", JSON.stringify(parsed).slice(0, 500));
      return null;
    }
    return sanitized;
  } catch (err: any) {
    console.error("[ai-brief] callGemini: threw error:", err?.message || err, err?.stack?.slice(0, 300));
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

      // Cache check.
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
            cached:   true,
            fallback: false,
          },
        });
        return;
      }

      // Fresh generation: build merchant snapshot, then prompt Gemini.
      const snapshot = await buildMerchantSnapshot(userId, prisma, language, focus, "TRY");
      const generated = await callGemini(snapshot);
      const brief = generated || FALLBACK_BRIEF;

      // Persist cache (best-effort — never block response on cache failure).
      await prisma.customerDailyBrief.upsert({
        where:  { customerUserId_briefDate: { customerUserId: userId, briefDate } },
        update: {
          criticalCard:    brief.criticalCard,
          attentionCard:   brief.attentionCard,
          opportunityCard: brief.opportunityCard,
          focusArea:       focus,
          generatedAt:     new Date(),
          expiresAt:       next6am(),
        },
        create: {
          customerUserId:  userId,
          briefDate,
          criticalCard:    brief.criticalCard,
          attentionCard:   brief.attentionCard,
          opportunityCard: brief.opportunityCard,
          focusArea:       focus,
          expiresAt:       next6am(),
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

      // Per-merchant rate limit on forced regeneration to bound Gemini spend.
      const last = refreshLastAt.get(userId) || 0;
      const now = Date.now();
      if (now - last < REFRESH_RATELIMIT_MS) {
        const waitSeconds = Math.ceil((REFRESH_RATELIMIT_MS - (now - last)) / 1000);
        res.status(429).json({
          success: false,
          error: `Çok hızlı — ${waitSeconds} saniye sonra tekrar dene.`,
        });
        return;
      }
      refreshLastAt.set(userId, now);

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
