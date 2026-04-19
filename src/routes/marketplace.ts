import { Router } from "express";
import { marketplaceController } from "../controllers/marketplaceController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.get("/orders",                          marketplaceController.listOrders);
router.get("/integrations",                    marketplaceController.listIntegrations);
router.post("/integrations",                   marketplaceController.saveIntegration);
router.post("/sync/:channel",                  marketplaceController.sync);
router.post("/orders/:id/create-invoice",      marketplaceController.createInvoice);

export default router;
