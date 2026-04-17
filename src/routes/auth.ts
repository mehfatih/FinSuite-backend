import { Router } from "express";
import { authController } from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/register", authRateLimiter, authController.register);
router.post("/login", authRateLimiter, authController.login);
router.get("/me", authenticate, authController.me);
router.put("/change-password", authenticate, authController.changePassword);

export default router;
