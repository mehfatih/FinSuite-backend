import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { downloadInvoicePdf } from '../controllers/invoicePdfController';

const router = Router();

// GET /api/invoices/:id/pdf
router.get('/:id/pdf', authenticate as any, downloadInvoicePdf);

export default router;