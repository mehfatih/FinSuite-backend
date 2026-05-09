// ================================================================
// Sprint D-4 — Customer V2 notification routes.
// Mounted at /api/customer/notifications.
//
// All require auth EXCEPT GET /stream — that's authenticated via
// the JWT in the `?token=…` query string (see streamToken.ts).
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { notificationsV2Controller } from "../../controllers/customer/notificationsV2Controller";

const router = Router();

router.get(   "/stream",        notificationsV2Controller.stream);   // JWT in ?token=…, no middleware
router.get(   "/stream-token",  authenticate, notificationsV2Controller.streamToken);
router.get(   "/unread-count",  authenticate, notificationsV2Controller.unreadCount);
router.get(   "/",              authenticate, notificationsV2Controller.list);
router.patch( "/bulk-read",     authenticate, notificationsV2Controller.bulkRead);
router.patch( "/:id/read",      authenticate, notificationsV2Controller.markRead);
router.patch( "/:id/archive",   authenticate, notificationsV2Controller.archive);

export default router;
