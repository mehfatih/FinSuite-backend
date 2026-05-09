// ================================================================
// Sprint D-3 — Sharing recipient routes. Mounted under
// /api/customer/recipients. All routes require customer auth.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { sharingRecipientsController } from "../../controllers/customer/sharingRecipientsController";

const router = Router();

router.get(   "/",    authenticate, sharingRecipientsController.list);
router.post(  "/",    authenticate, sharingRecipientsController.create);
router.patch( "/:id", authenticate, sharingRecipientsController.update);
router.delete("/:id", authenticate, sharingRecipientsController.remove);

export default router;
