import { Router } from "express";
import { personnelController } from "../controllers/personnelController";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate as any);

router.post("/calculate",  personnelController.calculate);
router.post("/bulk-slip",  personnelController.generateBulk);
router.get("/",            personnelController.list);
router.get("/:id",         personnelController.getById);
router.post("/",           personnelController.create);
router.put("/:id",         personnelController.update);
router.post("/:id/slip",   personnelController.generateSlip);

export default router;
