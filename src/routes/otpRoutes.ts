import { Router } from 'express';
import { requestOtp, verifyOtp } from '../controllers/otpController';

const router = Router();

// POST /api/auth/otp/request  — email veya phone gönder, OTP al
router.post('/request', requestOtp);

// POST /api/auth/otp/verify   — email/phone + code gönder, JWT al
router.post('/verify', verifyOtp);

export default router;