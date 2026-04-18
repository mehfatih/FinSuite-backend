// ================================================================
// Zyrix FinSuite — AI Assistant Controller
// Türk vergi hukuku ve iş dünyası konusunda uzman AI asistan
// ================================================================

import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Sistem Prompt ────────────────────────────────────────────
const SYSTEM_PROMPT = `Sen Zyrix FinSuite'in özel AI iş asistanısın. Türk vergi hukuku, 
muhasebe ve iş dünyası konularında uzmansın.

Uzmanlık alanların:
- KDV (Katma Değer Vergisi) hesaplama ve beyanname süreçleri
- Gelir ve kurumlar vergisi
- SGK (Sosyal Güvenlik Kurumu) primleri ve işçi maliyetleri
- E-Fatura ve E-Arşiv yükümlülükleri (GİB)
- Fatura kesme limitleri ve zorunlulukları
- İşletme giderleri ve vergi indirimleri
- Türk Ticaret Kanunu temel bilgileri
- KDV oranları: Genel %20, Gıda %10, Temel ihtiyaçlar %1
- Muhtasar beyanname, KDV beyannamesi tarihleri

Davranış kuralları:
- Türkçe yanıt ver
- Net ve pratik bilgiler ver
- Rakamlar ver: "yaklaşık %20 KDV" gibi
- Karmaşık konularda "muhasebecine danış" uyarısı ekle
- Asla kesin hukuki tavsiye verme — rehberlik sun
- Kısa ve öz yanıtlar ver (max 3 paragraf)
- Merchant'ın kendi verilerine göre kişiselleştirilmiş öneriler sun

Örnek sorular: "KDV nasıl hesaplanır?", "Bu gideri düşebilir miyim?", 
"E-fatura zorunluluğu ne zaman başladı?", "SGK primini nasıl hesaplarim?"`;

// ── Anthropic API Call ───────────────────────────────────────
async function callAnthropicAPI(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Fallback yerel yanıtlar — API key yokken
    return generateLocalResponse(messages[messages.length - 1]?.content || "");
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[AI Assistant] Anthropic error:", err);
      return generateLocalResponse(messages[messages.length - 1]?.content || "");
    }

    const data = await response.json();
    return data.content?.[0]?.text || "Yanıt alınamadı.";
  } catch (err) {
    console.error("[AI Assistant] fetch error:", err);
    return generateLocalResponse(messages[messages.length - 1]?.content || "");
  }
}

// ── Yerel Yanıtlar (API key yokken) ─────────────────────────
function generateLocalResponse(question: string): string {
  const q = question.toLowerCase();

  if (q.includes("kdv") && q.includes("hesap")) {
    return "KDV hesaplama: Satış tutarını 1.20 ile çarparak KDV dahil fiyatı bulursunuz (genel oran %20). KDV tutarı = Net tutar × 0.20. Gıda ürünleri için oran %10, temel ihtiyaçlar için %1'dir.";
  }
  if (q.includes("e-fatura") || q.includes("efatura")) {
    return "E-Fatura zorunluluğu: 2024 itibarıyla brüt satış hasılatı 3 milyon TL'yi aşan firmalar e-fatura kullanmak zorunda. GİB portalı üzerinden başvuru yapılır. Zyrix'in E-Fatura modülü bu süreci otomatikleştirir.";
  }
  if (q.includes("sgk") || q.includes("prim") || q.includes("sigorta")) {
    return "SGK primi: İşveren payı brüt maaşın %20.5'i, işçi payı %14'üdür. Toplam maliyet brüt maaşın yaklaşık %34.5'i kadardır. Asgari ücret altında çalışan yoksa sgk tabanından hesaplanır.";
  }
  if (q.includes("gider") && (q.includes("düşeb") || q.includes("indirim"))) {
    return "Gider indirimi: İşle ilgili kira, personel, ulaşım, ofis malzemeleri gider yazılabilir. Fatura/makbuz şart. Temsil ve ağırlama giderleri %70 oranında yazılabilir. Kişisel harcamalar kesinlikle yazılamaz. Muhasebecine danışman önerilir.";
  }
  if (q.includes("beyanname") || q.includes("vergi takvim")) {
    return "Vergi takviminiz: KDV beyannamesi her ayın 26'sına kadar, Muhtasar beyanname 3 ayda bir (Ocak, Nisan, Temmuz, Ekim), Kurumlar vergisi Nisan sonuna kadar, Gelir vergisi Mart sonuna kadar verilir.";
  }

  return "Bu konuda sizi yönlendireyim: Zyrix'in AI asistanı olarak Türk vergi hukuku, KDV, SGK, e-fatura ve genel muhasebe konularında destek verebilirim. Sorunuzu daha spesifik sorarsanız daha iyi yanıt alabiliriz. Hukuki kesinlik gerektiren konularda lisanslı muhasebeci veya mali müşavire danışmanızı öneririm.";
}

export const aiAssistantController = {

  // ── POST /api/ai-assistant/chat — mesaj gönder
  chat: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { message } = req.body;

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({ success: false, error: "Mesaj boş olamaz" });
        return;
      }

      if (message.trim().length > 2000) {
        res.status(400).json({ success: false, error: "Mesaj çok uzun (max 2000 karakter)" });
        return;
      }

      // Son 10 mesajı al — context için
      const recentChats = await prisma.aiAssistantChat.findMany({
        where: { merchantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { role: true, content: true },
      });

      // Eski → yeni sırala
      const history = recentChats.reverse();

      // Kullanıcı mesajını kaydet
      await prisma.aiAssistantChat.create({
        data: { merchantId, role: "user", content: message.trim() },
      });

      // Anthropic'e gönderilecek mesaj listesi
      const apiMessages = [
        ...history,
        { role: "user", content: message.trim() },
      ];

      // AI yanıtı al
      const aiResponse = await callAnthropicAPI(apiMessages);

      // AI yanıtını kaydet
      const savedResponse = await prisma.aiAssistantChat.create({
        data: { merchantId, role: "assistant", content: aiResponse },
      });

      res.status(200).json({
        success: true,
        data: {
          id: savedResponse.id,
          role: "assistant",
          content: aiResponse,
          createdAt: savedResponse.createdAt,
        },
      });
    } catch (err) {
      console.error("[AI Assistant chat]", err);
      res.status(500).json({ success: false, error: "AI yanıt veremedì" });
    }
  }),

  // ── GET /api/ai-assistant/history — sohbet geçmişi
  history: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { limit = "50" } = req.query;

      const chats = await prisma.aiAssistantChat.findMany({
        where: { merchantId },
        orderBy: { createdAt: "asc" },
        take: parseInt(limit as string),
        select: { id: true, role: true, content: true, createdAt: true },
      });

      res.status(200).json({ success: true, data: { chats } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Geçmiş alınamadı" });
    }
  }),

  // ── DELETE /api/ai-assistant/history — geçmişi temizle
  clearHistory: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      await prisma.aiAssistantChat.deleteMany({ where: { merchantId } });
      res.status(200).json({ success: true, message: "Sohbet geçmişi temizlendi" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Geçmiş temizlenemedi" });
    }
  }),

  // ── POST /api/ai-assistant/quick — hızlı soru (geçmiş olmadan)
  quick: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { question } = req.body;
      if (!question) {
        res.status(400).json({ success: false, error: "Soru boş olamaz" });
        return;
      }
      const answer = await callAnthropicAPI([{ role: "user", content: question }]);
      res.status(200).json({ success: true, data: { answer } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Yanıt alınamadı" });
    }
  }),
};