// ================================================================
// Phase 13 — Support routes (tickets, messages, KB articles, search).
// All authenticated by the global authenticate middleware in index.ts.
// ================================================================
import { Router, Response } from "express";
import { prisma } from "../config/database";
import { authenticate } from "../middleware/auth";
import { AuthenticatedRequest } from "../types";

const router: Router = Router();
router.use(authenticate as any);

// ── Tickets ───────────────────────────────────────────────────
router.post("/tickets", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const userId = (auth.merchant as any).userId || merchantId;
    const { subject, description, category, priority } = req.body;
    if (!subject || !description) {
      return res.status(400).json({ success: false, error: "subject and description are required" });
    }
    const ticket = await prisma.supportTicket.create({
      data: {
        merchantId,
        userId,
        subject,
        description,
        category: category || null,
        priority: priority || "NORMAL",
        messages: {
          create: {
            authorType: "CUSTOMER",
            authorId: userId,
            content: description,
          },
        },
      },
      include: { messages: true },
    });
    return res.json({ success: true, data: ticket });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/tickets", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const tickets = await prisma.supportTicket.findMany({
      where: { merchantId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return res.json({ success: true, data: tickets });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/tickets/:id", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, merchantId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
    return res.json({ success: true, data: ticket });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/tickets/:id/messages", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const userId = (auth.merchant as any).userId || merchantId;
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, merchantId },
    });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: "CUSTOMER",
        authorId: userId,
        content: req.body.content,
        attachments: req.body.attachments || null,
      },
    });
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: "OPEN", updatedAt: new Date() },
    });
    return res.json({ success: true, data: message });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch("/tickets/:id/csat", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "rating must be 1-5" });
    }
    const ticket = await prisma.supportTicket.updateMany({
      where: { id: req.params.id, merchantId },
      data: { csatRating: rating, csatComment: comment || null, status: "CLOSED" },
    });
    return res.json({ success: true, data: { updated: ticket.count } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Knowledge base ────────────────────────────────────────────
router.get("/articles", async (req, res: Response) => {
  try {
    const { category, q } = req.query;
    const where: any = { published: true };
    if (category) where.category = String(category);
    if (q) {
      where.OR = [
        { titleEn: { contains: String(q), mode: "insensitive" } },
        { titleTr: { contains: String(q), mode: "insensitive" } },
        { titleAr: { contains: String(q) } },
      ];
    }
    const articles = await prisma.knowledgeBaseArticle.findMany({
      where,
      orderBy: [{ helpfulCount: "desc" }, { viewCount: "desc" }],
      take: 50,
    });
    return res.json({ success: true, data: articles });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/articles/:slug", async (req, res: Response) => {
  try {
    const article = await prisma.knowledgeBaseArticle.findUnique({
      where: { slug: req.params.slug },
    });
    if (!article) return res.status(404).json({ success: false, error: "Article not found" });
    await prisma.knowledgeBaseArticle.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    });
    return res.json({ success: true, data: article });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/articles/:id/helpful", async (req, res: Response) => {
  try {
    const helpful = req.body.helpful !== false;
    const article = await prisma.knowledgeBaseArticle.update({
      where: { id: req.params.id },
      data: helpful
        ? { helpfulCount: { increment: 1 } }
        : { notHelpfulCount: { increment: 1 } },
    });
    return res.json({ success: true, data: article });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── AI chatbot stub (replaceable with Gemini handler) ─────────
router.post("/chat", async (req, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "message required" });
    // Heuristic: keyword routing. Swap with real LLM call when ready.
    const lower = String(message).toLowerCase();
    let reply = "I can help you with invoicing, tax, banks, and AI features. Could you give me more detail?";
    if (lower.includes("invoice") || lower.includes("fatura")) reply = "To create an invoice: open the AI Invoice Autopilot from the sidebar, then dictate or type your invoice details. Want me to walk you through it?";
    else if (lower.includes("tax") || lower.includes("kdv")) reply = "Tax features live under Tax → AI Autopilot. The system auto-calculates VAT and prepares your declaration in 30 seconds.";
    else if (lower.includes("bank")) reply = "To connect a bank: Account → Settings → Banks → + Add Bank. We support 17 Turkish banks via Open Banking (BDDK regulated).";
    else if (lower.includes("2fa") || lower.includes("security")) reply = "You can enable two-factor authentication from Settings → Security. We support SMS, authenticator apps (TOTP), and passkeys.";
    return res.json({ success: true, data: { reply } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
