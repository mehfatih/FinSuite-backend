// ================================================================
// Phase 15 — Customer Cmd+K AI intent endpoint.
// POST /api/customer/cmdk-intent  (customer auth)
// Body: { query, language?: 'tr'|'en'|'ar' }
// Returns: { success: true, data: { suggestion: { title, description, route } | null } }
// Never throws on Gemini failures; always returns success with suggestion=null.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

const SYSTEM_PROMPT = `Sen Zyrix FinSuite CRM'de kullanıcının komut paleti niyetini yorumlayan bir AI'sın.
Kullanıcı kısa bir cümle yazıyor (TR/EN/AR). Niyetini bul ve şu kategorilerden birine eşleştir:

ROUTES:
- /sales/invoices (faturalar, satış faturası, invoice)
- /sales/invoices?new=1 (yeni fatura, fatura oluştur, create invoice)
- /customers (müşteri listesi, müşteriler, customers)
- /customers?new=1 (müşteri ekle, add customer)
- /tax/calendar (vergi takvimi, tax dates, KDV ne zaman)
- /tax/autopilot (vergi otopilot, otomatik vergi)
- /cash/bank-recon (banka mutabakatı, bank reconciliation)
- /ai/cfo (AI CFO, mali tavsiye)
- /ai/brief (günlük brifing, daily summary)
- /predictions/cash (nakit tahmin, cash forecast)
- /predictions/churn (churn, müşteri kaybı)
- /risk/hidden-cash (gizli para, hidden cash)
- /reports/monthly (aylık rapor, monthly report)

YANIT FORMATI: Sadece JSON dön, başka hiçbir şey yazma:
{
  "title":       "kısa başlık (kullanıcının dilinde)",
  "description": "1 cümle açıklama (kullanıcının dilinde)",
  "route":       "yukarıdaki listeden bir route"
}

Eğer hiçbir route uygun değilse, en yakın olanı seç.`;

export const cmdkController = {
  intent: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      const { query, language = "tr" } = (req.body || {}) as { query?: string; language?: string };
      if (!query || query.trim().length < 2) {
        res.status(200).json({ success: true, data: { suggestion: null } });
        return;
      }

      if (!genAI) {
        // Graceful degrade when no Gemini key — palette still works without AI.
        res.status(200).json({ success: true, data: { suggestion: null } });
        return;
      }

      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const prompt = `${SYSTEM_PROMPT}\n\nKullanıcı dili: ${language}\nKullanıcı sorgusu: "${query.trim()}"`;

      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);

      if (!result) {
        res.status(200).json({ success: true, data: { suggestion: null } });
        return;
      }

      const text = (result as any).response?.text?.() || "";
      let parsed: any = null;
      try {
        const cleaned = text.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        res.status(200).json({ success: true, data: { suggestion: null } });
        return;
      }

      if (!parsed || !parsed.route || !parsed.title) {
        res.status(200).json({ success: true, data: { suggestion: null } });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          suggestion: {
            title:       String(parsed.title).slice(0, 80),
            description: parsed.description ? String(parsed.description).slice(0, 160) : "",
            route:       String(parsed.route),
          },
        },
      });
    } catch (err: any) {
      // Never break the palette — silently return null suggestion on any failure.
      console.error("[customer/cmdk-intent] error:", err?.message || err);
      res.status(200).json({ success: true, data: { suggestion: null } });
    }
  }),
};
