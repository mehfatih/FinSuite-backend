import { Router } from 'express';
import {
  sendOverdueInvoiceReminders,
  sendInstallmentReminders,
  sendTaxCalendarReminders,
  processRecurringInvoices,
} from '../controllers/cronController';

const router = Router();

// كل الـ endpoints دي محمية بـ x-cron-secret header
// يتم استدعاؤها من Railway Cron أو Cron-job.org

router.post('/reminders/overdue-invoices', sendOverdueInvoiceReminders);
router.post('/reminders/installments',     sendInstallmentReminders);
router.post('/reminders/tax-calendar',     sendTaxCalendarReminders);
router.post('/process-recurring',          processRecurringInvoices);

export default router;