import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/database";
import { env } from "../config/env";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const authController = {

  register: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, email, phone, password, country, language, currency } = req.body;

      if (!name || !email || !phone || !password) {
        res.status(400).json({ success: false, error: "Missing required fields" });
        return;
      }

      const existing = await prisma.merchant.findFirst({
        where: { OR: [{ email }, { phone }] }
      });

      if (existing) {
        res.status(409).json({ success: false, error: "Email or phone already registered" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      const merchant = await prisma.merchant.create({
        data: {
          name,
          email,
          phone,
          passwordHash,
          country: country || "TR",
          language: language || "TR",
          currency: currency || "TRY",
          trialEndsAt,
          subscriptions: {
            create: {
              planName: "STARTER",
              amount: 0,
              currency: "USD",
              interval: "MONTHLY",
              status: "TRIAL",
              currentPeriodStart: new Date(),
              currentPeriodEnd: trialEndsAt,
            }
          }
        },
        select: {
          id: true, name: true, email: true, phone: true,
          merchantId: true, language: true, currency: true,
          status: true, plan: true, country: true, onboardingDone: true,
        }
      });

      const token = jwt.sign(
        { id: merchant.id, email: merchant.email, plan: merchant.plan, language: merchant.language, currency: merchant.currency },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn }
      );

      res.status(201).json({ success: true, data: { merchant, token } });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ success: false, error: "Registration failed" });
    }
  }),

  login: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ success: false, error: "Email and password required" });
        return;
      }

      const merchant = await prisma.merchant.findUnique({ where: { email } });

      if (!merchant || !merchant.passwordHash) {
        res.status(401).json({ success: false, error: "Invalid credentials" });
        return;
      }

      const valid = await bcrypt.compare(password, merchant.passwordHash);
      if (!valid) {
        res.status(401).json({ success: false, error: "Invalid credentials" });
        return;
      }

      if (merchant.status === "SUSPENDED") {
        res.status(403).json({ success: false, error: "Account suspended" });
        return;
      }

      const token = jwt.sign(
        { id: merchant.id, email: merchant.email, plan: merchant.plan, language: merchant.language, currency: merchant.currency },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn }
      );

      res.status(200).json({
        success: true,
        data: {
          token,
          merchant: {
            id: merchant.id, name: merchant.name, email: merchant.email,
            merchantId: merchant.merchantId, language: merchant.language,
            currency: merchant.currency, status: merchant.status,
            plan: merchant.plan, country: merchant.country,
            onboardingDone: merchant.onboardingDone,
          }
        }
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ success: false, error: "Login failed" });
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
        }
      });

      if (!merchant) {
        res.status(404).json({ success: false, error: "Merchant not found" });
        return;
      }

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
      if (!merchant || !merchant.passwordHash) {
        res.status(404).json({ success: false, error: "Merchant not found" });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, merchant.passwordHash);
      if (!valid) {
        res.status(401).json({ success: false, error: "Current password incorrect" });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.merchant.update({ where: { id: merchantId }, data: { passwordHash } });

      res.status(200).json({ success: true, message: "Password changed successfully" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to change password" });
    }
  }),
};
