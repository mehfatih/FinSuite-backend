// ============================================================
// Zyrix FinSuite - WhatsApp Reminder Service
// Sprint 2 - WhatsApp Expansion
//
// Sends automated reminders for overdue/upcoming invoices.
// Schedule: 7 days before due, on due date, 3/7/14 days overdue.
// ============================================================

import { prisma } from "../config/database";
import { sendWhatsAppMessage } from "./whatsappService";

export type ReminderTier = "BEFORE_DUE_7" | "ON_DUE" | "OVERDUE_3" | "OVERDUE_7" | "OVERDUE_14";

export interface ReminderResult {
  invoicesProcessed: number;
  remindersSent: number;
  remindersFailed: number;
  remindersSkipped: number;
  byTier: Record<ReminderTier, number>;
}

/**
 * Build reminder text based on language and tier.
 */
function buildReminderText(
  language: "TR" | "EN" | "AR",
  tier: ReminderTier,
  customerName: string,
  invoiceNumber: string,
  amount: string,
  currency: string,
  dueDate: string,
  daysDiff: number
): string {
  const dateOnly = dueDate.substring(0, 10);

  if (language === "AR") {
    if (tier === "BEFORE_DUE_7") {
      return "مرحباً " + customerName + "،\nتذكير ودي: فاتورة #" + invoiceNumber + " بمبلغ " + amount + " " + currency + " مستحقة خلال " + daysDiff + " أيام (" + dateOnly + ").\nشكراً للدفع في الوقت المحدد.";
    }
    if (tier === "ON_DUE") {
      return "مرحباً " + customerName + "،\nفاتورة #" + invoiceNumber + " بمبلغ " + amount + " " + currency + " مستحقة اليوم (" + dateOnly + ").\nشكراً لمتابعة الدفع.";
    }
    return "مرحباً " + customerName + "،\nفاتورة #" + invoiceNumber + " بمبلغ " + amount + " " + currency + " متأخرة عن الاستحقاق منذ " + daysDiff + " أيام (تاريخ الاستحقاق: " + dateOnly + ").\nنرجو التواصل لتسوية الدفع.";
  }

  if (language === "EN") {
    if (tier === "BEFORE_DUE_7") {
      return "Hello " + customerName + ",\nFriendly reminder: Invoice #" + invoiceNumber + " for " + amount + " " + currency + " is due in " + daysDiff + " days (" + dateOnly + ").\nThank you for paying on time.";
    }
    if (tier === "ON_DUE") {
      return "Hello " + customerName + ",\nInvoice #" + invoiceNumber + " for " + amount + " " + currency + " is due today (" + dateOnly + ").\nThank you for processing payment.";
    }
    return "Hello " + customerName + ",\nInvoice #" + invoiceNumber + " for " + amount + " " + currency + " is " + daysDiff + " days overdue (was due " + dateOnly + ").\nPlease arrange payment at your earliest convenience.";
  }

  // TR (default)
  if (tier === "BEFORE_DUE_7") {
    return "Merhaba " + customerName + ",\nDostane bir hatirlatma: #" + invoiceNumber + " numarali, " + amount + " " + currency + " tutarli faturanizin vadesi " + daysDiff + " gun sonra (" + dateOnly + ") doluyor.\nZamaninda odeme icin tesekkurler.";
  }
  if (tier === "ON_DUE") {
    return "Merhaba " + customerName + ",\n#" + invoiceNumber + " numarali, " + amount + " " + currency + " tutarli faturanizin vadesi bugun (" + dateOnly + ").\nOdemeniz icin tesekkurler.";
  }
  return "Merhaba " + customerName + ",\n#" + invoiceNumber + " numarali, " + amount + " " + currency + " tutarli faturanizin vadesi " + daysDiff + " gun once doldu (vade: " + dateOnly + ").\nLutfen en kisa zamanda odemenizi yapiniz.";
}

/**
 * Determine which reminder tier (if any) applies to an invoice based on dueDate.
 */
function getTier(dueDate: Date, today: Date): { tier: ReminderTier | null; daysDiff: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((dueDate.getTime() - today.getTime()) / dayMs);

  if (diff === 7) return { tier: "BEFORE_DUE_7", daysDiff: 7 };
  if (diff === 0) return { tier: "ON_DUE", daysDiff: 0 };
  if (diff === -3) return { tier: "OVERDUE_3", daysDiff: 3 };
  if (diff === -7) return { tier: "OVERDUE_7", daysDiff: 7 };
  if (diff === -14) return { tier: "OVERDUE_14", daysDiff: 14 };
  return { tier: null, daysDiff: 0 };
}

/**
 * Process all eligible invoices for a single merchant.
 * Skips invoices that already received the same tier reminder this period.
 */
export async function sendDueReminders(merchantId: string, language: "TR" | "EN" | "AR" = "TR"): Promise<ReminderResult> {
  const result: ReminderResult = {
    invoicesProcessed: 0,
    remindersSent: 0,
    remindersFailed: 0,
    remindersSkipped: 0,
    byTier: {
      BEFORE_DUE_7: 0, ON_DUE: 0, OVERDUE_3: 0, OVERDUE_7: 0, OVERDUE_14: 0,
    },
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Eligible: SENT or OVERDUE invoices with customerPhone
  const invoices = await prisma.invoice.findMany({
    where: {
      merchantId,
      status: { in: ["SENT", "OVERDUE"] as any },
      customerPhone: { not: null },
    },
    select: {
      id: true,
      invoiceNumber: true,
      customerName: true,
      customerPhone: true,
      total: true,
      currency: true,
      dueDate: true,
    },
  });

  for (const inv of invoices) {
    result.invoicesProcessed++;

    const { tier, daysDiff } = getTier(inv.dueDate, today);
    if (!tier) {
      result.remindersSkipped++;
      continue;
    }

    if (!inv.customerPhone) {
      result.remindersSkipped++;
      continue;
    }

    // Check if we already sent this tier today
    const startOfDay = new Date(today);
    const endOfDay = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const existing = await prisma.whatsAppMessage.findFirst({
      where: {
        invoiceId: inv.id,
        messageType: "reminder_" + tier,
        createdAt: { gte: startOfDay, lt: endOfDay },
      },
    });

    if (existing) {
      result.remindersSkipped++;
      continue;
    }

    const text = buildReminderText(
      language,
      tier,
      inv.customerName,
      inv.invoiceNumber,
      String(inv.total),
      inv.currency,
      inv.dueDate.toISOString(),
      daysDiff
    );

    const row = await prisma.whatsAppMessage.create({
      data: {
        merchantId,
        invoiceId: inv.id,
        recipientPhone: inv.customerPhone,
        messageType: "reminder_" + tier,
        bodyText: text,
        status: "PENDING" as any,
      } as any,
    });

    const sendResult = await sendWhatsAppMessage({
      recipientPhone: inv.customerPhone,
      bodyText: text,
    });

    if (sendResult.success) {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "SENT" as any,
          providerMessageId: sendResult.providerMessageId || null,
          providerResponse: (sendResult.providerResponse as any) || undefined,
          sentAt: new Date(),
        } as any,
      });
      result.remindersSent++;
      result.byTier[tier]++;
    } else {
      await prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED" as any,
          failureReason: sendResult.error || "Unknown error",
        } as any,
      });
      result.remindersFailed++;
    }

    // 100ms throttle
    await new Promise((r) => setTimeout(r, 100));
  }

  return result;
}

/**
 * Run reminder job for ALL active merchants. Called by cron.
 */
export async function runRemindersForAll(): Promise<{ merchantsProcessed: number; totals: ReminderResult }> {
  const merchants = await prisma.merchant.findMany({
    where: { status: { in: ["ACTIVE", "TRIAL"] as any } },
    select: { id: true, language: true },
  });

  const totals: ReminderResult = {
    invoicesProcessed: 0,
    remindersSent: 0,
    remindersFailed: 0,
    remindersSkipped: 0,
    byTier: {
      BEFORE_DUE_7: 0, ON_DUE: 0, OVERDUE_3: 0, OVERDUE_7: 0, OVERDUE_14: 0,
    },
  };

  for (const m of merchants) {
    const lang = (m.language as any) || "TR";
    const r = await sendDueReminders(m.id, lang);
    totals.invoicesProcessed += r.invoicesProcessed;
    totals.remindersSent += r.remindersSent;
    totals.remindersFailed += r.remindersFailed;
    totals.remindersSkipped += r.remindersSkipped;
    for (const k of Object.keys(r.byTier) as ReminderTier[]) {
      totals.byTier[k] += r.byTier[k];
    }
  }

  return { merchantsProcessed: merchants.length, totals };
}
