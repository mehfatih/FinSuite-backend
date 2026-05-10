// ================================================================
// Sprint D-6 — Gemini-backed weekly narrative composition.
//
// Long-form prose (2 paragraphs, ~350-400 words) interpreting the
// week's KPIs + insights for a Turkey/MENA SMB owner. Per the hard
// rule, this is a fully separate service from aiBriefController.ts
// (which is daily-brief-shaped, JSON-output, route-allowlisted).
//
// Per-week caching is enforced by the generator (re-uses
// WeeklyReport.narrative unless force=true), so this function is
// called at most once per merchant per week unless an admin or
// engineering process explicitly forces regeneration.
//
// Failure modes (timeout, parse, empty response, missing API key)
// fall back to a localized canned narrative — the report still
// ships rather than blocking on a flaky LLM dependency.
// ================================================================
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env";
import type { WeeklySnapshot } from "./weeklyKpis";

const TIMEOUT_MS = 8_000;
const MAX_CHARS  = 1_800;       // ~400 words; bound prompt-injection blast radius

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

export interface ComposeArgs {
  snapshot:     WeeklySnapshot;
  merchantName: string;
  insights:     Array<{ type: string; title: string; body: string }>;
  language:     "tr" | "en" | "ar";
}

const FALLBACK = {
  tr: "Bu hafta için kısa bir not: KPI'larınız ve son içgörüleriniz aşağıda hazır. Yorumun bir sonraki çalıştırmada güncellenecek. Önemli sayılar (MRR, nakit, marj, nakit ömrü) ile başlayıp ilk fırsatınıza odaklanın.",
  en: "A short note for this week: your KPIs and latest insights are ready below. The full commentary will refresh on the next run. Start with the headline numbers (MRR, cash, margin, runway) and act on the top opportunity.",
  ar: "ملاحظة قصيرة لهذا الأسبوع: مؤشراتك ورؤاك الأخيرة جاهزة أدناه. سيتم تحديث التعليق الكامل في التشغيل القادم. ابدأ بالأرقام الرئيسية (الإيرادات، النقد، الهامش، عمر النقد) ثم انتقل إلى الفرصة الأولى."
} as const;

function fmtTRY(n: number): string {
  return `${Math.round(n).toLocaleString("tr-TR")} ₺`;
}
function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function buildPrompt(args: ComposeArgs): string {
  const { snapshot, merchantName, insights, language } = args;
  const k = snapshot.kpis;

  const facts: string[] = [];
  facts.push(`Hafta: ${snapshot.weekStart} - ${snapshot.weekEnd}`);
  facts.push(`MRR: ${fmtTRY(k.mrr.value)} (haftalık değişim ${fmtPct(k.mrr.deltaPct)})`);
  facts.push(`Net Nakit: ${fmtTRY(k.netCash.value)} (haftalık değişim ${fmtPct(k.netCash.deltaPct)})`);
  facts.push(`Brüt Marj: ${k.margin.value.toFixed(1)}% (haftalık değişim ${fmtPct(k.margin.deltaPct)})`);
  facts.push(`Nakit Ömrü: ${k.runway.value} gün (haftalık değişim ${fmtPct(k.runway.deltaPct)})`);
  facts.push(`Toplam Hafta Geliri: ${fmtTRY(snapshot.revenue.total)}`);
  if (snapshot.revenue.bestDay) {
    facts.push(`En İyi Gün: ${snapshot.revenue.bestDay.date} (${fmtTRY(snapshot.revenue.bestDay.amount)})`);
  }
  facts.push(`İçeri Akış: ${fmtTRY(snapshot.cash.inflowTotal)} | Dışarı Akış: ${fmtTRY(snapshot.cash.outflowTotal)}`);
  if (snapshot.customers.topCustomerShare > 0) {
    facts.push(`En Büyük Müşteri Payı (son 30 gün): ${snapshot.customers.topCustomerShare.toFixed(1)}%`);
  }
  if (snapshot.tax.upcoming.length > 0) {
    const next = snapshot.tax.upcoming[0];
    facts.push(`Yaklaşan Vergi: ${next.title} (${next.dueDate}, ${fmtTRY(next.amount)})`);
  }

  const insightLines = insights.length > 0
    ? insights.map((i, n) => `${n + 1}. [${i.type}] ${i.title} — ${i.body}`).join("\n")
    : "(Bu hafta için kayıtlı içgörü yok.)";

  const langTag    = language === "ar" ? "ARABIC" : language === "en" ? "ENGLISH" : "TURKISH";
  const langInstrA = language === "ar" ? "الردّ يجب أن يكون باللغة العربية فقط."
                   : language === "en" ? "Respond in English only."
                                       : "Yanıt sadece Türkçe olmalı.";

  return `Sen Zyrix FinSuite'in AI Co-Pilot'usun. Türkiye/MENA'daki bir KOBİ sahibi (${merchantName}) için haftalık performans yorumu yazıyorsun. Bu metin onun pazar günü akşam okuyacağı icra özeti olacak.

VERİ:
${facts.join("\n")}

İÇGÖRÜLER (bu hafta üretildi):
${insightLines}

GÖREV:
İki paragraflık (yaklaşık 350 kelime, en fazla ${MAX_CHARS} karakter) bir icra özeti yaz. Spesifik sayıları kullan (genel cümlelerden kaçın), trendleri yorumla, ve ikinci paragrafın sonunda bir aksiyon önerisi ver. Madde işareti veya başlık KULLANMA — sadece düz, akıcı paragraf metni.

DİL: ${langTag}. ${langInstrA}

YANIT FORMATI: Sadece düz metin döndür. Başka hiçbir şey, JSON veya açıklama EKLEME.`;
}

function sanitize(s: string): string {
  let cleaned = s.replace(/^```[a-z]*\n?|```$/gim, "").trim();
  if (cleaned.length > MAX_CHARS) cleaned = cleaned.slice(0, MAX_CHARS).trim();
  return cleaned;
}

export async function composeNarrative(args: ComposeArgs): Promise<string> {
  if (!genAI) {
    console.error("[weeklyReport/narrative] GEMINI_API_KEY missing — using fallback.");
    return FALLBACK[args.language] || FALLBACK.tr;
  }

  try {
    const model  = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = buildPrompt(args);

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))
    ]);
    if (!result) {
      console.error("[weeklyReport/narrative] Gemini timed out — using fallback.");
      return FALLBACK[args.language] || FALLBACK.tr;
    }

    const text = (result as any).response?.text?.() || "";
    if (!text || text.trim().length < 80) {
      console.error("[weeklyReport/narrative] Gemini returned empty/short text — using fallback.");
      return FALLBACK[args.language] || FALLBACK.tr;
    }

    return sanitize(text);
  } catch (err: any) {
    console.error("[weeklyReport/narrative] Gemini threw — using fallback:", err?.message || err);
    return FALLBACK[args.language] || FALLBACK.tr;
  }
}
