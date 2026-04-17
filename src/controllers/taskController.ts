import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const taskController = {

  list: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { status, priority, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

      const where: any = { merchantId };
      if (status) where.status = status;
      if (priority) where.priority = priority;

      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where, skip, take: parseInt(limit as string),
          orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
          include: { customer: { select: { id: true, name: true } } }
        }),
        prisma.task.count({ where }),
      ]);

      res.status(200).json({ success: true, data: { tasks, total } });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to get tasks" });
    }
  }),

  create: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const merchantId = req.merchant!.id;
      const { title, description, dueDate, priority, customerId, assignedTo } = req.body;

      if (!title) { res.status(400).json({ success: false, error: "Title is required" }); return; }

      const task = await prisma.task.create({
        data: {
          merchantId, title, description,
          dueDate: dueDate ? new Date(dueDate) : null,
          priority: priority || "MEDIUM",
          customerId, assignedTo,
        },
        include: { customer: { select: { id: true, name: true } } }
      });
      res.status(201).json({ success: true, data: task });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to create task" });
    }
  }),

  update: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Task not found" }); return; }

      const updateData: any = { ...req.body };
      if (req.body.status === "DONE" && existing.status !== "DONE") updateData.completedAt = new Date();
      if (req.body.dueDate) updateData.dueDate = new Date(req.body.dueDate);

      const task = await prisma.task.update({
        where: { id: req.params.id },
        data: updateData,
        include: { customer: { select: { id: true, name: true } } }
      });
      res.status(200).json({ success: true, data: task });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to update task" });
    }
  }),

  delete: h(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const existing = await prisma.task.findFirst({
        where: { id: req.params.id, merchantId: req.merchant!.id }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Task not found" }); return; }

      await prisma.task.delete({ where: { id: req.params.id } });
      res.status(200).json({ success: true, message: "Task deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to delete task" });
    }
  }),
};
