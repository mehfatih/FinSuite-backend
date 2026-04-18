// ================================================================
// Zyrix FinSuite — Vergi Takvimi Controller (Feature 14)
// Türk vergi takvimi — otomatik hatırlatma + hazırlık takibi
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── Türk Vergi Takvimi Oluşturucu ────────────────────────────
function generateTaxCalendar(year: number) {
  const events: Array<{ type: string; title: string; description: string; dueDate: Date; period: string }> = [];

  // KDV Beyannamesi — her ayın 26'sı
  for (let m = 0; m < 12; m++) {
    const dueDate = new Date(year, m, 26);
    const period = `${year}-${String(m + 1).padStart(2, "0")}`;
    events.push({
      type: "KDV",
      title: `KDV Beyannamesi — ${dueDate.toLocaleString("tr-TR", { month: "long" })}`,
      description: "Aylık KDV beyannamesi verme ve ödeme vadesi",
      dueDate, period,
    });
  }

  // Muhtasar Beyanname — 3 ayda bir (Ocak, Nisan, Temmuz, Ekim 26)
  for (const m of [0, 3, 6, 9]) {
    const dueDate = new Date(year, m, 26);
    events.push({
      type: "MUHTASAR",
      title: `Muhtasar Beyanname — Q${Math.floor(m / 3) + 1}`,
      description: "Stopaj vergisi (muhtasar) beyannamesi",
      dueDate, period: `${year}-Q${Math.floor(m / 3) + 1}`,
    });
  }

  // SGK Bildirimi — her ayın son günü
  for (let m = 0; m < 12; m++) {
    const dueDate = new Date(year, m + 1, 0); // Ayın son günü
    const period = `${year}-${String(m + 1).padStart(2, "0")}`;
    events.push({
      type: "SGK",
      title: `SGK Primi — ${dueDate.toLocaleString("tr-TR", { month: "long" })}`,
      description: "Aylık SGK prim bildirimi ve ödeme",
      dueDate, period,
    });
  }

  // Kurumlar Vergisi — Nisan sonu
  events.push({
    type: "KURUMLAR",
    title: "Kurumlar Vergisi",
    description: "Yıllık kurumlar vergisi beyannamesi (30 Nisan)",
    dueDate: new Date(year, 3, 30),
    period: `${year}`,
  });

  // Gelir Vergisi — Mart sonu
  events.push({
    type: "GELIR",
    title: "Gelir Vergisi Beyannamesi",
    description: "Yıllık gelir vergisi beyannamesi (31 Mart)",
    dueDate: new Date(year, 2, 31),
    period: `${year}`,
  });

  return events;
}

export const taxCalendarController = {

  // ── GET /api/tax-calendar — takvim olayları
  list: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const { year = new Date().getFullYear(), upcoming } = req.query;
      const where: any = { merchantId };
      if (upcoming) where.dueDate = { gte: new Date() };

      const events = await prisma.taxEvent.findMany({ where, orderBy: { dueDate: "asc" } });
      const now = new Date();
      const enriched = events.map(e => ({
        ...e,
        isOverdue: !e.isSubmitted && new Date(e.dueDate) < now,
        daysUntil: Math.ceil((new Date(e.dueDate).getTime() - now.getTime()) / 86400000),
      }));

      res.json({ success: true, data: { events: enriched, total: events.length, overdueCount: enriched.filter(e => e.isOverdue).length } });
    } catch { res.status(500).json({ success: false, error: "Takvim alınamadı" }); }
  }),

  // ── POST /api/tax-calendar/generate — yılın tümünü otomatik oluştur
  generate: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const year = parseInt(req.body.year || new Date().getFullYear().toString());
      const events = generateTaxCalendar(year);
      let created = 0, skipped = 0;

      for (const ev of events) {
        const existing = await prisma.taxEvent.findFirst({
          where: { merchantId, type: ev.type as any, dueDate: ev.dueDate },
        });
        if (existing) { skipped++; continue; }
        await prisma.taxEvent.create({ data: { merchantId, ...ev, type: ev.type as any } });
        created++;
      }

      res.json({ success: true, data: { created, skipped, total: events.length }, message: `${year} vergi takvimi oluşturuldu: ${created} etkinlik` });
    } catch { res.status(500).json({ success: false, error: "Takvim oluşturulamadı" }); }
  }),

  // ── PATCH /api/tax-calendar/:id — hazırlandı / gönderildi işaretle
  updateStatus: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { isPrepared, isSubmitted, amount, notes } = req.body;
      const event = await prisma.taxEvent.findFirst({ where: { id: req.params.id, merchantId: req.merchant!.id } });
      if (!event) return res.status(404).json({ success: false, error: "Etkinlik bulunamadı" });

      const updated = await prisma.taxEvent.update({
        where: { id: req.params.id },
        data: {
          ...(isPrepared !== undefined && { isPrepared }),
          ...(isSubmitted !== undefined && { isSubmitted, submittedAt: isSubmitted ? new Date() : null }),
          ...(amount !== undefined && { amount }),
          ...(notes !== undefined && { notes }),
        },
      });
      res.json({ success: true, data: updated });
    } catch { res.status(500).json({ success: false, error: "Güncelleme başarısız" }); }
  }),

  // ── GET /api/tax-calendar/upcoming — önümüzdeki 30 gün
  upcoming: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const nextMonth = new Date(); nextMonth.setDate(nextMonth.getDate() + 30);
      const events = await prisma.taxEvent.findMany({
        where: { merchantId, isSubmitted: false, dueDate: { lte: nextMonth } },
        orderBy: { dueDate: "asc" },
      });
      const now = new Date();
      const enriched = events.map(e => ({
        ...e,
        isOverdue: new Date(e.dueDate) < now,
        daysUntil: Math.ceil((new Date(e.dueDate).getTime() - now.getTime()) / 86400000),
      }));

      // Beyan gönder bildirimleri
      const urgentEvents = enriched.filter(e => e.daysUntil <= 7 && !e.reminderSent);
      for (const ev of urgentEvents) {
        await prisma.notification.create({
          data: {
            merchantId,
            title: `⏰ ${ev.isOverdue ? "Gecikmiş" : "Yaklaşan"}: ${ev.title}`,
            body: ev.isOverdue ? `${ev.title} için son tarih geçti! Hemen muhasebecinizle iletişime geçin.` : `${ev.title} için ${ev.daysUntil} gün kaldı.`,
            type: ev.isOverdue ? "ERROR" : "WARNING",
          },
        });
        await prisma.taxEvent.update({ where: { id: ev.id }, data: { reminderSent: true } });
      }

      res.json({ success: true, data: { events: enriched, urgentCount: enriched.filter(e => e.daysUntil <= 7).length } });
    } catch { res.status(500).json({ success: false, error: "Yaklaşan etkinlikler alınamadı" }); }
  }),
};