import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const dealController = {

  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { stage, search, page = "1", limit = "50" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (stage) where.stage = stage;
      if (search) where.title = { contains: search as string, mode: "insensitive" };

      const [deals, total] = await Promise.all([
        prisma.deal.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: { createdAt: "desc" },
          include: { customer: { select: { id: true, name: true, company: true } } }
        }),
        prisma.deal.count({ where }),
      ]);

      const pipeline = await prisma.deal.groupBy({
        by: ["stage"],
        where: { merchantId },
        _count: { id: true },
        _sum: { value: true },
      });

      res.status(200).json({ success: true, data: { deals, total, pipeline } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get deals" });
    }
  }),

  getById: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const deal = await prisma.deal.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id },
        include: { customer: true }
      });
      if (!deal) { res.status(404).json({ success: false, error: "Deal not found" }); return; }
      res.status(200).json({ success: true, data: deal });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get deal" });
    }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { title, value, currency, customerId, stage, probability, expectedClose, notes } = req.body;

      if (!title || !value) { res.status(400).json({ success: false, error: "Title and value required" }); return; }

      const deal = await prisma.deal.create({
        data: {
          merchantId, title, value, currency: currency || "TRY",
          customerId, stage: stage || "LEAD",
          probability: probability || 20,
          expectedClose: expectedClose ? new Date(expectedClose) : null,
          notes,
        },
        include: { customer: { select: { id: true, name: true, company: true } } }
      });
      res.status(201).json({ success: true, data: deal });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to create deal" });
    }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.deal.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Deal not found" }); return; }

      const updateData: any = { ...req.body };
      if (req.body.stage === "WON" && existing.stage !== "WON") updateData.wonAt = new Date();
      if (req.body.stage === "LOST" && existing.stage !== "LOST") updateData.lostAt = new Date();
      if (req.body.expectedClose) updateData.expectedClose = new Date(req.body.expectedClose);

      const deal = await prisma.deal.update({
        where: { id: req.params.id },
        data: updateData,
        include: { customer: { select: { id: true, name: true, company: true } } }
      });
      res.status(200).json({ success: true, data: deal });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update deal" });
    }
  }),

  delete: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.deal.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Deal not found" }); return; }

      await prisma.deal.delete({ where: { id: req.params.id } });
      res.status(200).json({ success: true, message: "Deal deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to delete deal" });
    }
  }),
};
