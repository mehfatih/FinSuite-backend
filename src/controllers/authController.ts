import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { sendWelcomeEmail } from "../services/emailService";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

function isValidTurkishPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  return /^(\+90|0)5[0-9]{9}$/.test(cleaned);
}

function normalizeTurkishPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  if (cleaned.startsWith("05")) return "+90" + cleaned.slice(1);
  return cleaned;
}

async function checkAndUpdateMerchantStatus(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!merchant) return;
  const now = new Date();
  const sub = merchant.subscriptions[0];
  if (!sub) return;

  if (sub.status === "TRIAL" && merchant.trialEndsAt && now > merchant.trialEndsAt) {
    await prisma.merchant.update({ where: { id: merchantId }, data: { status: "EXPIRED" } });
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
    return;
  }

  if (sub.status === "ACTIVE" && now > sub.currentPeriodEnd) {
    const gracePeriodEnd = new Date(sub.currentPeriodEnd);
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 10);
    if (now <= gracePeriodEnd) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE" } });
    } else {
      await prisma.merchant.update({ where: { id: merchantId }, data: { status: "SUSPENDED" } });
    }
  }
}

export const authController = {

  register: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, email, phone, password, country, language, currency, businessName } = req.body;

      if (!name || !email || !phone || !password) {
        res.status(400).json({ success: false, error: "Name, email, phone and password are required" });
        return;
      }

      if (!isValidTurkishPhone(phone)) {
        res.status(400).json({
          success: false,
          error: "Geçersiz telefon numarası. Lütfen geçerli bir Türkiye numarası girin (örn: 0532 123 45 67)",
        });
        return;
      }

      const normalizedPhone = normalizeTurkishPhone(phone);

      const existing = await prisma.merchant.findFirst({
        where: { OR: [{ email }, { phone: normalizedPhone }] },
      });
      if (existing) {
        res.status(409).json({ success: false, error: "Bu e-posta veya telefon numarası zaten kayıtlı" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // 30-day trial
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const merchant = await prisma.merchant.create({
        data: {
          name,
          email,
          phone: normalizedPhone,
          passwordHash,
          businessName: businessName || name,
          country: country || "TR",
          language: (language as any) || "TR",
          currency: (currency as any) || "TRY",
          status: "TRIAL",
          plan: "STARTER",
          trialEndsAt,
          subscriptions: {
            create: {
              planName: "STARTER",
              amount: 0,
              currency: "TRY",
              interval: "MONTHLY",
              status: "TRIAL",
              currentPeriodStart: new Date(),
              currentPeriodEnd: trialEndsAt,
            },
          },
        },
        select: {
          id: true, name: true, email: true, phone: true,
          merchantId: true, language: true, currency: true,
          status: true, plan: true, country: true,
          onboardingDone: true, trialEndsAt: true,
        },
      });

      // Send welcome email (non-blocking)
      sendWelcomeEmail({
        to: merchant.email,
        name: merchant.name,
        trialEndsAt: merchant.trialEndsAt!,
      }).catch(err => console.error("Welcome email failed:", err));

      const token = jwt.sign(
        { id: merchant.id, email: merchant.email, plan: merchant.plan },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn }
      );

      res.status(201).json({ success: true, data: { merchant, token } });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ success: false, error: "Kayıt başarısız oldu" });
    }
  }),

  login: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ success: false, error: "E-posta ve şifre gerekli" });
        return;
      }

      const merchant = await prisma.merchant.findUnique({ where: { email } });

      if (!merchant || !merchant.passwordHash) {
        res.status(401).json({ success: false, error: "Geçersiz e-posta veya şifre" });
        return;
      }

      const valid = await bcrypt.compare(password, merchant.passwordHash);
      if (!valid) {
        res.status(401).json({ success: false, error: "Geçersiz e-posta veya şifre" });
        return;
      }

      await checkAndUpdateMerchantStatus(merchant.id);

      const updated = await prisma.merchant.findUnique({ where: { id: merchant.id } });
      if (!updated) { res.status(500).json({ success: false, error: "Giriş başarısız" }); return; }

      if (updated.status === "SUSPENDED") {
        res.status(403).json({
          success: false,
          error: "Hesabınız askıya alındı. Verileriniz güvende — yeniden aktifleştirmek için destek ile iletişime geçin.",
        });
        return;
      }

      const token = jwt.sign(
        { id: updated.id, email: updated.email, plan: updated.plan, language: updated.language, currency: updated.currency },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn }
      );

      // Warning for trial expiring in 3 days
      let warning: string | null = null;
      if (updated.trialEndsAt) {
        const daysLeft = Math.ceil((updated.trialEndsAt.getTime() - Date.now()) / 86400000);
        if (daysLeft <= 3 && daysLeft > 0) {
          warning = `Deneme süreniz ${daysLeft} gün içinde bitiyor. Kesintisiz devam etmek için abonelik seçin.`;
        } else if (daysLeft <= 0) {
          warning = "Deneme süreniz doldu. Lütfen bir abonelik planı seçin.";
        }
      }

      res.status(200).json({
        success: true,
        data: {
          token,
          merchant: {
            id: updated.id, name: updated.name, email: updated.email,
            merchantId: updated.merchantId, language: updated.language,
            currency: updated.currency, status: updated.status,
            plan: updated.plan, country: updated.country,
            onboardingDone: updated.onboardingDone, trialEndsAt: updated.trialEndsAt,
          },
          warning,
        },
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ success: false, error: "Giriş başarısız" });
    }
  }),

  me: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const merchantId = (req as any).merchant?.id;
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          id: true, name: true, email: true, phone: true,
          merchantId: true, language: true, currency: true,
          status: true, plan: true, country: true, businessName: true,
          businessType: true, timezone: true, onboardingDone: true,
          trialEndsAt: true, createdAt: true,
        },
      });
      if (!merchant) { res.status(404).json({ success: false, error: "Merchant not found" }); return; }
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get profile" });
    }
  }),

  changePassword: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const merchantId = (req as any).merchant?.id;
      const { currentPassword, newPassword } = req.body;
      const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
      if (!merchant || !merchant.passwordHash) { res.status(404).json({ success: false, error: "Merchant not found" }); return; }
      const valid = await bcrypt.compare(currentPassword, merchant.passwordHash);
      if (!valid) { res.status(401).json({ success: false, error: "Mevcut şifre hatalı" }); return; }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.merchant.update({ where: { id: merchantId }, data: { passwordHash } });
      res.status(200).json({ success: true, message: "Şifre başarıyla değiştirildi" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Şifre değiştirilemedi" });
    }
  }),
};