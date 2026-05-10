// ================================================================
// Sprint D-7 — Customer-side public share link routes.
// All authenticated; mounted at /api/customer/share-links.
// ================================================================
import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { publicShareLinksController } from "../../controllers/customer/publicShareLinksController";

const router = Router();

router.use(authenticate);

router.get("/",                                 publicShareLinksController.list);
router.post("/",                                publicShareLinksController.create);
router.get("/:id",                              publicShareLinksController.getById);
router.patch("/:id",                            publicShareLinksController.update);
router.delete("/:id",                           publicShareLinksController.revoke);
router.patch("/:id/comments/:commentId",        publicShareLinksController.hideComment);

export default router;
