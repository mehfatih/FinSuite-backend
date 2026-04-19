import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

const generateOtp = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

const OTP_EXPIRES_MINUTES = 10;

async function sendOtpEmail(email: string, otp: string, name?: string) {
  await resend.emails.send({
    from: 'Zyrix FinSuite <noreply@zyrix.co>',
    to: email,
    subject: `Giriş Kodu: ${otp}`,
    html: `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"/></head>
<body style="font-family:'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:32px 40px">
      <div style="font-size:22px;font-weight:800;color:#fff">Zyrix <span style="color:#38bdf8">FinSuite</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;letter-spacing:1px;text-transform:uppercase">Giriş Doğrulama</div>
    </div>
    <div style="padding:40px">
      <p style="font-size:15px;color:#0f172a;margin-bottom:8px">Merhaba${name ? ` ${name}` : ''},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:32px">
        Zyrix FinSuite hesabınıza giriş yapmak için aşağıdaki kodu kullanın.
        Bu kod <strong>${OTP_EXPIRES_MINUTES} dakika</strong> geçerlidir.
      </p>
      <div style="text-align:center;margin-bottom:32px">
        <div style="display:inline-block;background:#f0f9ff;border:2px dashed #0ea5e9;border-radius:12px;padding:20px 40px">
          <div style="font-size:11px;color:#0ea5e9;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Giriş Kodu</div>
          <div style="font-size:40px;font-weight:800;color:#0f172a;letter-spacing:10px">${otp}</div>
        </div>
      </div>
      <p style="font-size:12px;color:#94a3b8;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:20px">
        Bu kodu siz talep etmediyseniz, bu e-postayı görmezden gelebilirsiniz.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center">
      <span style="font-size:11px;color:#94a3b8">finsuite.zyrix.co · Otomatik gönderilmiştir</span>
    </div>
  </div>
</body>
</html>`,
  });
}

async function sendOtpSms(phone: string, otp: string) {
  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.warn('SMS credentials eksik — sadece email gönderildi');
    return;
  }
  const response = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      api_secret: apiSecret,
      from: 'ZyrixFin',
      to: phone.replace(/\D/g, ''),
      text: `Zyrix FinSuite giriş kodunuz: ${otp}\nBu kod ${OTP_EXPIRES_MINUTES} dakika geçerlidir.`,
    }),
  });
  const data = await response.json() as any;
  if (data.messages?.[0]?.status !== '0') {
    console.error('SMS gönderme hatası:', data.messages?.[0]);
  }
}

// ─── POST /api/auth/otp/request ───────────────────────────
export const requestOtp = async (req: Request, res: Response) => {
  const { email, phone } = req.body;
  if (!email && !phone) {
    return res.status(400).json({ error: 'Email veya telefon gereklidir' });
  }
  try {
    const merchant = await prisma.merchant.findFirst({
      where: email ? { email } : { phone },
    });
    if (!merchant) return res.json({ message: 'Kod gönderildi' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    await prisma.otpCode.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.otpCode.create({
      data: { merchantId: merchant.id, code: otpHash, channel: email ? 'EMAIL' : 'SMS', expiresAt },
    });

    if (email) await sendOtpEmail(email, otp, merchant.name);
    if (phone || merchant.phone) await sendOtpSms(phone || merchant.phone, otp).catch(() => {});

    return res.json({ message: 'Kod gönderildi', channel: email ? 'email' : 'sms' });
  } catch (err) {
    console.error('OTP request error:', err);
    return res.status(500).json({ error: 'Kod gönderilemedi' });
  }
};

// ─── POST /api/auth/otp/verify ────────────────────────────
export const verifyOtp = async (req: Request, res: Response) => {
  const { email, phone, code } = req.body;
  if (!code || (!email && !phone)) {
    return res.status(400).json({ error: 'Email/telefon ve kod gereklidir' });
  }
  try {
    const merchant = await prisma.merchant.findFirst({
      where: email ? { email } : { phone },
    });
    if (!merchant) return res.status(401).json({ error: 'Geçersiz kod' });

    const otpHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
    const otpRecord = await prisma.otpCode.findFirst({
      where: { merchantId: merchant.id, code: otpHash, expiresAt: { gt: new Date() }, used: false },
    });
    if (!otpRecord) return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş kod' });

    await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } });

    const token = jwt.sign(
      { merchantId: merchant.id, email: merchant.email },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      merchant: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
        businessName: merchant.businessName,
        onboardingDone: merchant.onboardingDone,
      },
    });
  } catch (err) {
    console.error('OTP verify error:', err);
    return res.status(500).json({ error: 'Doğrulama başarısız' });
  }
};