import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { AdminRequest } from "../../types";
import { sendWelcomeEmail } from "../../services/emailService";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const adminMerchantsController = {

  list: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, status, plan, country, page = "1", limit = "20", archived } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const where: any = {};

      // By default exclude archived unless explicitly requested
      if (archived === "true") {
        where.archivedAt = { not: null };
      } else {
        where.archivedAt = null;
      }

      if (status) where.status = status;
      if (plan)   where.plan   = plan;
      if (country) where.country = country;
      if (search) where.OR = [
        { name:         { contains: search as string, mode: "insensitive" } },
        { email:        { contains: search as string, mode: "insensitive" } },
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
            trialEndsAt: true, createdAt: true, archivedAt: true,
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
          subscriptions: { orderBy: { createdAt: "desc" }, take: 3 },
          featureFlags: true,
          notifications: { orderBy: { createdAt: "desc" }, take: 5 },
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

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const merchant = await prisma.merchant.create({
        data: {
          name, email, passwordHash,
          businessName: businessName || name,
          phone: phone || null,
          country: country || "İstanbul",
          plan: (plan as any) || "STARTER",
          status: "ACTIVE",
          trialEndsAt,
        },
        select: { id: true, name: true, email: true, plan: true, status: true, createdAt: true, trialEndsAt: true }
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

      // Send welcome email (non-blocking)
      if (merchant.trialEndsAt) {
        sendWelcomeEmail({ to: merchant.email, name: merchant.name, trialEndsAt: merchant.trialEndsAt })
          .catch(err => console.error("Welcome email failed:", err));
      }

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
        data: { adminId: req.admin!.id, action: "UPDATE_MERCHANT_STATUS", targetType: "merchant", targetId: req.params.id, details: { status, merchantName: merchant.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update status" });
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
        data: { adminId: req.admin!.id, action: "UPDATE_MERCHANT_PLAN", targetType: "merchant", targetId: req.params.id, details: { plan, merchantName: merchant.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update plan" });
    }
  }),

  // ── PATCH /api/admin/merchants/:id — update any fields ────
  update: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { name, businessName, phone, country, adminNotes, trialEndsAt } = req.body;
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: {
          ...(name         !== undefined && { name }),
          ...(businessName !== undefined && { businessName }),
          ...(phone        !== undefined && { phone }),
          ...(country      !== undefined && { country }),
          ...(adminNotes   !== undefined && { adminNotes }),
          ...(trialEndsAt  !== undefined && { trialEndsAt: new Date(trialEndsAt) }),
        },
        select: { id: true, name: true, email: true, businessName: true, phone: true, country: true, adminNotes: true, trialEndsAt: true }
      });
      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "UPDATE_MERCHANT", targetType: "merchant", targetId: req.params.id, details: req.body, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update merchant" });
    }
  }),

  // ── POST /api/admin/merchants/:id/extend-trial ────────────
  extendTrial: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { days } = req.body;
      if (!days || days < 1) { res.status(400).json({ success: false, error: "Invalid days" }); return; }

      const current = await prisma.merchant.findUnique({ where: { id: req.params.id }, select: { trialEndsAt: true, name: true } });
      if (!current) { res.status(404).json({ success: false, error: "Not found" }); return; }

      const base = current.trialEndsAt && current.trialEndsAt > new Date() ? current.trialEndsAt : new Date();
      const newTrialEnd = new Date(base);
      newTrialEnd.setDate(newTrialEnd.getDate() + parseInt(days));

      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { trialEndsAt: newTrialEnd, status: "TRIAL" },
        select: { id: true, name: true, trialEndsAt: true, status: true }
      });

      // Send notification to merchant
      await prisma.notification.create({
        data: {
          merchantId: req.params.id,
          title: "Deneme Süresi Uzatıldı! 🎁",
          body: `Hesabınıza ${days} günlük ek deneme süresi eklenmiştir. Yeni bitiş tarihi: ${newTrialEnd.toLocaleDateString("tr-TR")}`,
          type: "SUCCESS",
        }
      });

      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "EXTEND_TRIAL", targetType: "merchant", targetId: req.params.id, details: { days, newTrialEnd, merchantName: current.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to extend trial" });
    }
  }),

  // ── POST /api/admin/merchants/:id/notify ─────────────────
  sendNotification: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { title, body, type = "INFO" } = req.body;
      if (!title || !body) { res.status(400).json({ success: false, error: "Title and body required" }); return; }

      await prisma.notification.create({
        data: { merchantId: req.params.id, title, body, type }
      });

      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "SEND_NOTIFICATION", targetType: "merchant", targetId: req.params.id, details: { title, body, type }, ipAddress: req.ip }
      });
      res.status(201).json({ success: true, message: "Notification sent" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to send notification" });
    }
  }),

  // ── POST /api/admin/merchants/:id/archive ────────────────
  archive: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { archivedAt: new Date(), status: "SUSPENDED" },
        select: { id: true, name: true, archivedAt: true }
      });
      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "ARCHIVE_MERCHANT", targetType: "merchant", targetId: req.params.id, details: { merchantName: merchant.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant, message: "Merchant archived. Data preserved." });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to archive merchant" });
    }
  }),

  // ── POST /api/admin/merchants/:id/unarchive ──────────────
  unarchive: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { archivedAt: null, status: "ACTIVE" },
        select: { id: true, name: true, status: true }
      });
      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "UNARCHIVE_MERCHANT", targetType: "merchant", targetId: req.params.id, details: { merchantName: merchant.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, data: merchant });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to unarchive merchant" });
    }
  }),

  // ── DELETE /api/admin/merchants/:id ──────────────────────
  // Permanent delete — requires confirmation
  delete: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { confirm } = req.body;
      if (confirm !== "DELETE") {
        res.status(400).json({ success: false, error: 'Send { confirm: "DELETE" } to confirm permanent deletion' }); return;
      }

      const merchant = await prisma.merchant.findUnique({
        where: { id: req.params.id },
        select: { name: true, email: true }
      });
      if (!merchant) { res.status(404).json({ success: false, error: "Merchant not found" }); return; }

      // Cascade delete via Prisma (all related data)
      await prisma.merchant.delete({ where: { id: req.params.id } });

      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "DELETE_MERCHANT", targetType: "merchant", targetId: req.params.id, details: { merchantName: merchant.name, email: merchant.email }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, message: `Merchant "${merchant.name}" permanently deleted` });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to delete merchant" });
    }
  }),

  // ── POST /api/admin/merchants/:id/reset-password ─────────
  resetPassword: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 8) {
        res.status(400).json({ success: false, error: "Password must be at least 8 characters" }); return;
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const merchant = await prisma.merchant.update({
        where: { id: req.params.id },
        data: { passwordHash },
        select: { id: true, name: true, email: true }
      });
      await prisma.notification.create({
        data: { merchantId: req.params.id, title: "Şifreniz Sıfırlandı 🔒", body: "Hesabınızın şifresi yönetici tarafından sıfırlandı. Yeni şifrenizle giriş yapabilirsiniz.", type: "WARNING" }
      });
      await prisma.auditLog.create({
        data: { adminId: req.admin!.id, action: "RESET_MERCHANT_PASSWORD", targetType: "merchant", targetId: req.params.id, details: { merchantName: merchant.name }, ipAddress: req.ip }
      });
      res.status(200).json({ success: true, message: "Password reset successfully" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to reset password" });
    }
  }),

  // ── GET /api/admin/merchants/:id/audit ───────────────────
  getAuditLog: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const logs = await prisma.auditLog.findMany({
        where: { targetId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { admin: { select: { name: true, email: true } } }
      });
      res.status(200).json({ success: true, data: logs });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get audit log" });
    }
  }),
};