import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const customerController = {

  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { search, tags, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (search) where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
        { phone: { contains: search as string, mode: "insensitive" } },
        { company: { contains: search as string, mode: "insensitive" } },
      ];
      if (tags) where.tags = { hasSome: (tags as string).split(",") };

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
          include: {
            _count: { select: { deals: true, tasks: true } }
          }
        }),
        prisma.customer.count({ where }),
      ]);

      res.status(200).json({ success: true, data: { customers, total, page: parseInt(page as string), limit: parseInt(limit as string) } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get customers" });
    }
  }),

  getById: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const customer = await prisma.customer.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: {
          deals: { orderBy: { createdAt: "desc" }, take: 10 },
          tasks: { orderBy: { createdAt: "desc" }, take: 10 },
        }
      });
      if (!customer) { res.status(404).json({ success: false, error: "Customer not found" }); return; }
      res.status(200).json({ success: true, data: customer });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get customer" });
    }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { name, email, phone, company, country, address, tags, notes } = req.body;

      if (!name) { res.status(400).json({ success: false, error: "Name is required" }); return; }

      const customer = await prisma.customer.create({
        data: { merchantId, name, email, phone, company, country, address, tags: tags || [], notes }
      });
      res.status(201).json({ success: true, data: customer });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to create customer" });
    }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.customer.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Customer not found" }); return; }

      const customer = await prisma.customer.update({
        where: { id: req.params.id },
        data: req.body,
      });
      res.status(200).json({ success: true, data: customer });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update customer" });
    }
  }),

  delete: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.customer.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Customer not found" }); return; }

      await prisma.customer.delete({ where: { id: req.params.id } });
      res.status(200).json({ success: true, message: "Customer deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to delete customer" });
    }
  }),

  addLoyaltyPoints: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.customer.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Customer not found" }); return; }

      const { points } = req.body;
      const customer = await prisma.customer.update({
        where: { id: req.params.id },
        data: { loyaltyPoints: { increment: parseInt(points) } },
      });
      res.status(200).json({ success: true, data: customer });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update loyalty points" });
    }
  }),
};
