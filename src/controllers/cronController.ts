// ================================================================
// Zyrix FinSuite — Email Reminders Cron Controller
// تذكيرات تلقائية: فواتير متأخرة + تقاسيط قريبة + ضرائب
// ================================================================
import { Request, Response, RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';

const prisma = new PrismaClient();
const resend  = new Resend(process.env.RESEND_API_KEY);

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Email Templates ───────────────────────────────────────────
function overdueInvoiceEmail(invoice: any, merchant: any): string {
  const days = Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000);
  return `
<div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#dc2626,#f97316);padding:28px 36px">
      <div style="color:#fff;font-size:20px;font-weight:800">Zyrix <span style="opacity:0.8">FinSuite</span></div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:4px">Ödeme Hatırlatması ⚠️</div>
    </div>
    <div style="padding:32px 36px">
      <p style="font-size:15px;color:#0f172a;margin-bottom:8px">Sayın ${invoice.customerName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px">
        <strong>${merchant.businessName || merchant.name}</strong> tarafından kesilen aşağıdaki fatura
        <strong style="color:#dc2626">${days} gün</strong> önce vadesi dolmuş olup ödeme beklenmektedir.
      </p>
      <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:13px">Fatura No:</span>
          <span style="color:#0f172a;font-weight:700;font-size:13px;font-family:monospace">${invoice.invoiceNumber}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:13px">Tutar:</span>
          <span style="color:#dc2626;font-weight:800;font-size:16px">₺${Number(invoice.total).toLocaleString('tr-TR')}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#64748b;font-size:13px">Vade Tarihi:</span>
          <span style="color:#dc2626;font-weight:600;font-size:13px">${new Date(invoice.dueDate).toLocaleDateString('tr-TR')}</span>
        </div>
      </div>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6">
        Ödemenizi gerçekleştirdiyseniz bu mesajı dikkate almayınız.
        Sorularınız için <strong>${merchant.email || ''}</strong> adresine ulaşabilirsiniz.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 36px;text-align:center;border-top:1px solid #e2e8f0">
      <span style="font-size:11px;color:#94a3b8">Zyrix FinSuite tarafından otomatik gönderilmiştir — finsuite.zyrix.co</span>
    </div>
  </div>
</div>`;
}

function installmentReminderEmail(installment: any, plan: any, merchant: any): string {
  const daysUntil = Math.ceil((new Date(installment.dueDate).getTime() - Date.now()) / 86400000);
  return `
<div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 36px">
      <div style="color:#fff;font-size:20px;font-weight:800">Zyrix <span style="opacity:0.8">FinSuite</span></div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:4px">Taksit Hatırlatması 📅</div>
    </div>
    <div style="padding:32px 36px">
      <p style="font-size:15px;color:#0f172a;margin-bottom:8px">Sayın ${plan.customerName},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px">
        <strong>${daysUntil}</strong> gün içinde ödenmesi gereken taksitiniz bulunmaktadır.
      </p>
      <div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:20px 24px;margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:13px">Taksit:</span>
          <span style="color:#6366f1;font-weight:700;font-size:13px">${installment.installmentNo}. Taksit</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:13px">Tutar:</span>
          <span style="color:#6366f1;font-weight:800;font-size:16px">₺${Number(installment.amount).toLocaleString('tr-TR')}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#64748b;font-size:13px">Son Tarih:</span>
          <span style="color:#6366f1;font-weight:600;font-size:13px">${new Date(installment.dueDate).toLocaleDateString('tr-TR')}</span>
        </div>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 36px;text-align:center;border-top:1px solid #e2e8f0">
      <span style="font-size:11px;color:#94a3b8">Zyrix FinSuite — finsuite.zyrix.co</span>
    </div>
  </div>
</div>`;
}

function taxReminderEmail(event: any, merchant: any): string {
  const daysUntil = Math.ceil((new Date(event.dueDate).getTime() - Date.now()) / 86400000);
  const isOverdue = daysUntil < 0;
  return `
<div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,${isOverdue ? '#dc2626,#f97316' : '#0ea5e9,#6366f1'});padding:28px 36px">
      <div style="color:#fff;font-size:20px;font-weight:800">Zyrix <span style="opacity:0.8">FinSuite</span></div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:4px">Vergi Takvimi ${isOverdue ? '⚠️ GECİKMİŞ' : '⏰ Hatırlatma'}</div>
    </div>
    <div style="padding:32px 36px">
      <p style="font-size:15px;color:#0f172a;margin-bottom:8px">Sayın ${merchant.name},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px">
        ${isOverdue
          ? `<strong style="color:#dc2626">${event.title}</strong> için son tarih geçti! Lütfen en kısa sürede muhasebecinizle iletişime geçin.`
          : `<strong>${event.title}</strong> için <strong>${daysUntil} gün</strong> kaldı.`
        }
      </p>
      <div style="background:${isOverdue ? '#fef2f2' : '#f0f9ff'};border:1.5px solid ${isOverdue ? '#fca5a5' : '#bae6fd'};border-radius:12px;padding:20px 24px">
        <div style="font-weight:700;color:${isOverdue ? '#dc2626' : '#0ea5e9'};margin-bottom:8px">${event.title}</div>
        <div style="color:#64748b;font-size:13px">${event.description || ''}</div>
        <div style="color:#64748b;font-size:13px;margin-top:8px">Son Tarih: <strong>${new Date(event.dueDate).toLocaleDateString('tr-TR')}</strong></div>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 36px;text-align:center;border-top:1px solid #e2e8f0">
      <span style="font-size:11px;color:#94a3b8">Zyrix FinSuite — finsuite.zyrix.co</span>
    </div>
  </div>
</div>`;
}

// ── Main Cron Jobs ────────────────────────────────────────────

// POST /api/cron/reminders/overdue-invoices
// Railway Cron veya harici cron service tarafından çağrılır
export const sendOverdueInvoiceReminders = h(async (req: Request, res: Response) => {
  // Basit güvenlik: secret header
  const secret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1-30 gün gecikmiş, email'i olan faturalar
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['SENT', 'OVERDUE'] },
        dueDate: { lt: new Date(), gte: thirtyDaysAgo },
        customerEmail: { not: null },
      },
      include: {
        merchant: { select: { name: true, businessName: true, email: true } },
      },
      take: 50,
    });

    let sent = 0, failed = 0;

    for (const invoice of overdueInvoices) {
      if (!invoice.customerEmail) continue;
      try {
        await resend.emails.send({
          from: 'Zyrix FinSuite <noreply@zyrix.co>',
          to: invoice.customerEmail,
          subject: `Ödeme Hatırlatması — Fatura ${invoice.invoiceNumber}`,
          html: overdueInvoiceEmail(invoice, invoice.merchant),
        });

        // Faturayı OVERDUE olarak işaretle
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'OVERDUE' },
        });

        sent++;
      } catch (err) {
        console.error(`[Cron] Overdue email failed for ${invoice.id}:`, err);
        failed++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ success: true, data: { sent, failed, total: overdueInvoices.length } });
  } catch (err) {
    console.error('[Cron] overdue-invoices error:', err);
    res.status(500).json({ success: false, error: 'Cron job failed' });
  }
});

// POST /api/cron/reminders/installments
export const sendInstallmentReminders = h(async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const threeDaysFromNow = new Date(Date.now() + 3 * 86400000);

    // Yaklaşan taksitler (3 gün içinde) + email'i olan
    const upcoming = await prisma.installment.findMany({
      where: {
        status: 'PENDING',
        dueDate: { gte: new Date(), lte: threeDaysFromNow },
      },
      include: {
        plan: {
          include: {
            merchant: { select: { name: true, businessName: true, email: true } },
          },
        },
      },
      take: 50,
    });

    let sent = 0, failed = 0;

    for (const installment of upcoming) {
      const customerEmail = installment.plan.merchant?.email;
      if (!customerEmail) continue;

      try {
        await resend.emails.send({
          from: 'Zyrix FinSuite <noreply@zyrix.co>',
          to: customerEmail,
          subject: `Taksit Hatırlatması — ${installment.installmentNo}. Taksit`,
          html: installmentReminderEmail(installment, installment.plan, installment.plan.merchant),
        });
        sent++;
      } catch (err) {
        console.error(`[Cron] Installment email failed:`, err);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ success: true, data: { sent, failed, total: upcoming.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Cron job failed' });
  }
});

// POST /api/cron/reminders/tax-calendar
export const sendTaxCalendarReminders = h(async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 86400000);

    const urgentEvents = await prisma.taxEvent.findMany({
      where: {
        isSubmitted: false,
        reminderSent: false,
        dueDate: { lte: sevenDaysFromNow },
      },
      include: {
        merchant: { select: { name: true, email: true, businessName: true } },
      },
      take: 100,
    });

    let sent = 0, failed = 0;

    for (const event of urgentEvents) {
      if (!event.merchant.email) continue;

      try {
        await resend.emails.send({
          from: 'Zyrix FinSuite <noreply@zyrix.co>',
          to: event.merchant.email,
          subject: `Vergi Takvimi: ${event.title}`,
          html: taxReminderEmail(event, event.merchant),
        });

        await prisma.taxEvent.update({
          where: { id: event.id },
          data: { reminderSent: true },
        });

        sent++;
      } catch (err) {
        console.error(`[Cron] Tax reminder failed:`, err);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    res.json({ success: true, data: { sent, failed, total: urgentEvents.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Cron job failed' });
  }
});

// POST /api/cron/process-recurring — Tekrarlayan faturaları işle
export const processRecurringInvoices = h(async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const due = await prisma.recurringInvoice.findMany({
      where: { status: 'ACTIVE', nextRunDate: { lte: new Date() } },
    });

    let processed = 0;

    for (const r of due) {
      try {
        const count = await prisma.invoice.count({ where: { merchantId: r.merchantId } });
        const invoiceNumber = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

        await prisma.invoice.create({
          data: {
            merchantId: r.merchantId, invoiceNumber,
            customerName: r.customerName,
            customerEmail: r.customerEmail,
            customerPhone: r.customerPhone,
            items: r.items, subtotal: r.subtotal,
            vatRate: r.vatRate, vatAmount: r.vatAmount,
            total: r.total, currency: r.currency,
            status: 'SENT',
            dueDate: new Date(Date.now() + 30 * 86400000),
            notes: `Otomatik tekrarlayan fatura`,
          },
        });

        const next = new Date(r.nextRunDate);
        if (r.interval === 'MONTHLY') next.setMonth(next.getMonth() + 1);
        else next.setFullYear(next.getFullYear() + 1);

        await prisma.recurringInvoice.update({
          where: { id: r.id },
          data: { lastRunDate: new Date(), nextRunDate: next, runCount: { increment: 1 } },
        });

        processed++;
      } catch (err) {
        console.error(`[Cron] Recurring failed for ${r.id}:`, err);
      }
    }

    res.json({ success: true, data: { processed, total: due.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Cron job failed' });
  }
});