import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AdminRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const adminAuthController = {

  login: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, error: "Email and password required" }); return;
      }
      const admin = await prisma.adminUser.findUnique({ where: { email } });
      if (!admin || !admin.isActive) {
        res.status(401).json({ success: false, error: "Invalid credentials" }); return;
      }
      const valid = await bcrypt.compare(password, admin.passwordHash);
      if (!valid) {
        res.status(401).json({ success: false, error: "Invalid credentials" }); return;
      }
      await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      const token = jwt.sign(
        { id: admin.id, email: admin.email, role: admin.role },
        env.jwtAdminSecret,
        { expiresIn: "12h" }
      );
      res.status(200).json({ success: true, data: { token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Login failed" });
    }
  }),

  setup: h(async (req: Request, res: Response): Promise<void> => {
    try {
      const existing = await prisma.adminUser.count();
      if (existing > 0) {
        res.status(403).json({ success: false, error: "Setup already completed" }); return;
      }
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        res.status(400).json({ success: false, error: "All fields required" }); return;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const admin = await prisma.adminUser.create({
        data: { name, email, passwordHash, role: "SUPER_ADMIN" },
        select: { id: true, name: true, email: true, role: true }
      });
      res.status(201).json({ success: true, data: admin });
    } catch (err) {
      res.status(500).json({ success: false, error: "Setup failed" });
    }
  }),

  createAdmin: h(async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      if (req.admin?.role !== "SUPER_ADMIN") {
        res.status(403).json({ success: false, error: "Only SUPER_ADMIN can create admins" }); return;
      }
      const { name, email, password, role } = req.body;
      if (!name || !email || !password) {
        res.status(400).json({ success: false, error: "All fields required" }); return;
      }
      const existing = await prisma.adminUser.findUnique({ where: { email } });
      if (existing) {
        res.status(409).json({ success: false, error: "Email already exists" }); return;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const admin = await prisma.adminUser.create({
        data: { name, email, passwordHash, role: role || "SUPPORT" },
        select: { id: true, name: true, email: true, role: true }
      });
      res.status(201).json({ success: true, data: admin });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to create admin" });
    }
  }),
};
