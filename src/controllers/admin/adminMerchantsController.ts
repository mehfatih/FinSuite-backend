import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { AdminRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const adminMerchantsController = {

  list: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, plan, country, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const where: any = {};
      if (status) where.status = status;
      if (plan) where.plan = plan;
      if (country) where.country = country;
      if (search) where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
        { businessName: { contains: search as string, mode: "insensitive" } },
      ];
      const [merchants, total] = await Promise.all([
        prisma.merchant.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, email: true, phone: true, merchantId: true,
            businessName: true, country: true, status: true, plan: true,
            language: true, currency: true, onboardingDone: true,
            trialEndsAt: true, createdAt: true,
            _count: { select: { customers: true, invoices: true, deals: true } }
          }
        }),
        prisma.merchant.count({ where }),
      ]);
      res.status(200).json({ success: true, data: { merchants, total, page: parseInt(page as string), limit: parseInt(limit as string) } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get merchants" });
    }
  }),

  getById: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: req.params.id },
        include: {
          subscriptions: true,
          featureFlags: true,
          _count: { select: { customers: true, invoices: true, deals: true, tasks: true } }
        }
      });
      if (!merchant) { res.status(404).json({ success: false, error: "Merchant not found" }); return; }
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get merchant" });
    }
  }),

  create: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { name, email, password, businessName, phone, country, plan } = req.body;
      if (!name || !email || !password) {
        res.status(400).json({ success: false, error: "Name, email and password are required" }); return;
      }
      const existing = await prisma.merchant.findUnique({ where: { email } });
      if (existing) {
        res.status(409).json({ success: false, error: "Email already exists" }); return;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const merchant = await prisma.merchant.create({
        data: {
          name,
          email,
          passwordHash,
          businessName: businessName || name,
          phone: phone || null,
          country: country || "US",
          plan: plan || "FREE",
          status: "ACTIVE",
        },
        select: { id: true, name: true, email: true, plan: true, status: true, createdAt: true }
      });
      await prisma.auditLog.create({
        data: {
          adminId: req.admin!.id,
          action: "CREATE_MERCHANT",
          targetType: "merchant",
          targetId: merchant.id,
          details: { merchantName: name, email },
          ipAddress: req.ip,
        }
      });
      res.status(201).json({ success: true, data: merchant });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Failed to create merchant" });
    }
  }),

  updateStatus: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { status } = req.body;
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { status },
        select: { id: true, name: true, email: true, status: true }
      });
      await prisma.auditLog.create({
        data: {
          adminId: req.admin!.id,
          action: "UPDATE_MERCHANT_STATUS",
          targetType: "merchant",
          targetId: req.params.id,
          details: { status, merchantName: merchant.name },
          ipAddress: req.ip,
        }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update merchant status" });
    }
  }),

  updatePlan: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { plan } = req.body;
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { plan },
        select: { id: true, name: true, email: true, plan: true }
      });
      await prisma.auditLog.create({
        data: {
          adminId: req.admin!.id,
          action: "UPDATE_MERCHANT_PLAN",
          targetType: "merchant",
          targetId: req.params.id,
          details: { plan, merchantName: merchant.name },
          ipAddress: req.ip,
        }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update merchant plan" });
    }
  }),

};