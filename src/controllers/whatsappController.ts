// ================================================================
// Zyrix FinSuite — WhatsApp Business Controller (Feature 9)
// Fatura gönderimi + ödeme hatırlatma via WhatsApp Business API
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const WA_TOKEN   = process.env.WHATSAPP_TOKEN;
const WA_PHONE   = process.env.WHATSAPP_PHONE_ID;
const FRONTEND   = process.env.FRONTEND_URL || "https://finsuite.zyrix.co";

// ── WhatsApp API Sender ───────────────────────────────────────
async function sendWhatsApp(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Türkiye formatı normalize et: 05xx → +905xx
  const normalized = to.replace(/\s/g, "").replace(/^0/, "+90");

  if (!WA_TOKEN || !WA_PHONE) {
    console.log(`[WhatsApp] Sandbox — would send to ${normalized}: ${message.slice(0, 60)}...`);
    return { success: true, messageId: `sandbox-${Date.now()}` };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized.replace("+", ""),
        type: "text",
        text: { body: message },
      }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data?.error?.message || "WhatsApp API error" };
    return { success: true, messageId: data?.messages?.[0]?.id };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ── Mesaj Şablonları ─────────────────────────────────────────
function invoiceMessage(invoice: any, merchant: any): string {
  return `🧾 *Fatura Bildirimi*\n\nSayın ${invoice.customerName},\n\n*${merchant.businessName || merchant.name}* tarafından size fatura kesildi.\n\n📋 Fatura No: *${invoice.invoiceNumber}*\n💰 Tutar: *${Number(invoice.total).toLocaleString("tr-TR")} ${invoice.currency}*\n📅 Vade: *${new Date(invoice.dueDate).toLocaleDateString("tr-TR")}*\n\nBilgi için iletişime geçebilirsiniz.\n\n_Zyrix FinSuite_`;
}

function reminderMessage(invoice: any, merchant: any, daysOverdue: number): string {
  const isOverdue = daysOverdue > 0;
  return `${isOverdue ? "⚠️" : "🔔"} *Ödeme ${isOverdue ? "Hatırlatması" : "Yaklaşıyor"}*\n\nSayın ${invoice.customerName},\n\n${isOverdue ? `*${daysOverdue} gün* önce vadesi dolan` : "Yakında vadesi gelecek"} ${invoice.invoiceNumber} no'lu faturanız için ödeme beklenmektedir.\n\n💰 Tutar: *${Number(invoice.total).toLocaleString("tr-TR")} ${invoice.currency}*\n📅 Vade: *${new Date(invoice.dueDate).toLocaleDateString("tr-TR")}*\n\nÖdemenizi gerçekleştirdiyseniz bu mesajı dikkate almayınız.\n\n_${merchant.businessName || merchant.name}_`;
}

export const whatsappController = {

  // ── POST /api/whatsapp/send-invoice/:invoiceId
  sendInvoice: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.invoiceId, merchantId: req.merchant!.id },
      });
      if (!invoice) return res.status(404).json({ success: false, error: "Fatura bulunamadı" });
      if (!invoice.customerPhone) return res.status(400).json({ success: false, error: "Müşteri telefon numarası yok" });

      const merchant = await prisma.merchant.findUnique({ where: { id: req.merchant!.id }, select: { name: true, businessName: true } });
      const message = invoiceMessage(invoice, merchant);
      const result = await sendWhatsApp(invoice.customerPhone, message);

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { whatsappSentAt: new Date(), whatsappStatus: result.success ? "sent" : "failed" },
      });

      res.json({ success: result.success, data: { messageId: result.messageId }, message: result.success ? "Fatura WhatsApp ile gönderildi" : result.error });
    } catch { res.status(500).json({ success: false, error: "WhatsApp gönderilemedi" }); }
  }),

  // ── POST /api/whatsapp/remind/:invoiceId
  sendReminder: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { id: req.params.invoiceId, merchantId: req.merchant!.id },
      });
      if (!invoice) return res.status(404).json({ success: false, error: "Fatura bulunamadı" });
      if (!invoice.customerPhone) return res.status(400).json({ success: false, error: "Müşteri telefon numarası yok" });
      if (invoice.status === "PAID") return res.status(400).json({ success: false, error: "Fatura zaten ödendi" });

      const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000);
      const merchant = await prisma.merchant.findUnique({ where: { id: req.merchant!.id }, select: { name: true, businessName: true } });
      const message = reminderMessage(invoice, merchant, daysOverdue);
      const result = await sendWhatsApp(invoice.customerPhone, message);

      res.json({ success: result.success, data: { messageId: result.messageId, daysOverdue }, message: result.success ? "Hatırlatma gönderildi" : result.error });
    } catch { res.status(500).json({ success: false, error: "Hatırlatma gönderilemedi" }); }
  }),

  // ── POST /api/whatsapp/bulk-remind — vadesi geçmiş tümüne gönder
  bulkRemind: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const overdueInvoices = await prisma.invoice.findMany({
        where: { merchantId, status: { in: ["SENT", "OVERDUE"] }, dueDate: { lt: new Date() }, customerPhone: { not: null } },
        take: 20,
      });

      if (overdueInvoices.length === 0) return res.json({ success: true, data: { sent: 0 }, message: "Vadesi geçmiş fatura yok" });

      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, businessName: true } });
      let sent = 0, failed = 0;

      for (const invoice of overdueInvoices) {
        const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000);
        const result = await sendWhatsApp(invoice.customerPhone!, reminderMessage(invoice, merchant, daysOverdue));
        if (result.success) {
          sent++;
          await prisma.invoice.update({ where: { id: invoice.id }, data: { whatsappSentAt: new Date(), whatsappStatus: "sent" } });
        } else { failed++; }
        await new Promise(r => setTimeout(r, 500)); // Rate limit
      }

      res.json({ success: true, data: { sent, failed, total: overdueInvoices.length } });
    } catch { res.status(500).json({ success: false, error: "Toplu gönderim başarısız" }); }
  }),

  // ── POST /api/whatsapp/custom — özel mesaj
  sendCustom: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phone, message } = req.body;
      if (!phone || !message) return res.status(400).json({ success: false, error: "Telefon ve mesaj zorunlu" });
      const result = await sendWhatsApp(phone, message);
      res.json({ success: result.success, data: { messageId: result.messageId }, error: result.error });
    } catch { res.status(500).json({ success: false, error: "Mesaj gönderilemedi" }); }
  }),

  // ── GET /api/whatsapp/status — sandbox/production durumu
  status: h(async (req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, data: { mode: WA_TOKEN ? "production" : "sandbox", configured: !!WA_TOKEN, phoneId: WA_PHONE || null } });
  }),
};