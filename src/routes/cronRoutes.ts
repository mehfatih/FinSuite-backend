import { Router } from 'express';
import {
  sendOverdueInvoiceReminders,
  sendInstallmentReminders,
  sendTaxCalendarReminders,
  processRecurringInvoices,
  runMorningBrief,
  runWeeklyReport,
  runChatCleanup,
} from '../controllers/cronController';

const router = Router();

// كل الـ endpoints دي محمية بـ x-cron-secret header
// يتم استدعاؤها من Railway Cron أو Cron-job.org

router.post('/reminders/overdue-invoices', sendOverdueInvoiceReminders);
router.post('/reminders/installments',     sendInstallmentReminders);
router.post('/reminders/tax-calendar',     sendTaxCalendarReminders);
router.post('/process-recurring',          processRecurringInvoices);

// Sprint D-5 — every 15 min, cron-job.org POSTs here with x-cron-secret
router.post('/morning-brief-tick',         runMorningBrief);

// Sprint D-6 — every 15 min, cron-job.org POSTs here with x-cron-secret
router.post('/weekly-report-tick',         runWeeklyReport);

// Sprint D-8 — nightly chat conversation cleanup (90-day retention default)
router.post('/chat-cleanup',               runChatCleanup);

export default router;