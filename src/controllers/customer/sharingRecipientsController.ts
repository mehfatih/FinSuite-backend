// ================================================================
// sharingRecipientsController.ts — CRUD over SharingRecipient.
// All endpoints scope by req.merchant.id; client-supplied IDs never
// trusted. Email and phone are optional individually but at least
// one of the two must be present so the recipient is reachable.
// Phone is normalized to E.164 before persistence.
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { e164, isValidE164 } from "../../services/sharing/phone";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const NAME_MAX     = 120;
const EMAIL_MAX    = 200;
const ROLE_MAX     = 60;
const AVATAR_MAX   = 500;
const RECIPIENT_HARD_CAP = 200;   // upper bound per merchant; UI advertises 50

function basicEmailOk(email: string): boolean {
  if (!email || email.length > EMAIL_MAX) return false;
  // Permissive: must have one @ and at least one dot in domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function trim(s: unknown, max: number): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t ? t.slice(0, max) : null;
}

export const sharingRecipientsController = {
  // ── GET /api/customer/recipients ───────────────────────────
  list: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), RECIPIENT_HARD_CAP);

      const rows = await prisma.sharingRecipient.findMany({
        where:   { merchantId: userId },
        orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take:    limit,
        select: {
          id: true, name: true, email: true, phone: true, role: true,
          avatarUrl: true, lastUsedAt: true, shareCount: true,
          createdAt: true, updatedAt: true
        }
      });

      res.status(200).json({ success: true, data: { recipients: rows, count: rows.length, limit } });
    } catch (err: any) {
      console.error("[recipients/list] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to list recipients." });
    }
  }),

  // ── POST /api/customer/recipients ──────────────────────────
  create: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

      const name      = trim(req.body?.name,      NAME_MAX);
      const emailRaw  = trim(req.body?.email,     EMAIL_MAX);
      const phoneRaw  = trim(req.body?.phone,     32);
      const role      = trim(req.body?.role,      ROLE_MAX);
      const avatarUrl = trim(req.body?.avatarUrl, AVATAR_MAX);

      if (!name) { res.status(400).json({ success: false, error: "Name is required." }); return; }
      if (emailRaw && !basicEmailOk(emailRaw)) {
        res.status(400).json({ success: false, error: "Invalid email format." }); return;
      }
      let phone: string | null = null;
      if (phoneRaw) {
        const norm = e164(phoneRaw);
        if (!norm) { res.status(400).json({ success: false, error: "Phone must be E.164 (e.g. +905551234567)." }); return; }
        phone = norm;
      }
      if (!emailRaw && !phone) {
        res.status(400).json({ success: false, error: "At least one contact method (email or phone) is required." });
        return;
      }

      // Upper bound on saved recipients per merchant.
      const existing = await prisma.sharingRecipient.count({ where: { merchantId: userId } });
      if (existing >= RECIPIENT_HARD_CAP) {
        res.status(409).json({ success: false, error: `Max ${RECIPIENT_HARD_CAP} recipients per merchant.` });
        return;
      }

      const created = await prisma.sharingRecipient.create({
        data: {
          merchantId: userId,
          name,
          email: emailRaw,
          phone,
          role,
          avatarUrl
        }
      });
      res.status(201).json({ success: true, data: { recipient: created } });
    } catch (err: any) {
      console.error("[recipients/create] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to create recipient." });
    }
  }),

  // ── PATCH /api/customer/recipients/:id ─────────────────────
  update: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const id = String(req.params.id || "");
      if (!id) { res.status(400).json({ success: false, error: "Missing recipient id." }); return; }

      const existing = await prisma.sharingRecipient.findFirst({
        where: { id, merchantId: userId }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Recipient not found." }); return; }

      const body = req.body || {};
      const data: any = {};
      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        const v = trim(body.name, NAME_MAX);
        if (!v) { res.status(400).json({ success: false, error: "Name cannot be empty." }); return; }
        data.name = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "email")) {
        const v = trim(body.email, EMAIL_MAX);
        if (v && !basicEmailOk(v)) { res.status(400).json({ success: false, error: "Invalid email format." }); return; }
        data.email = v;
      }
      if (Object.prototype.hasOwnProperty.call(body, "phone")) {
        const raw = trim(body.phone, 32);
        if (raw === null) {
          data.phone = null;
        } else {
          const norm = e164(raw);
          if (!norm) { res.status(400).json({ success: false, error: "Phone must be E.164." }); return; }
          data.phone = norm;
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, "role"))      data.role      = trim(body.role,      ROLE_MAX);
      if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) data.avatarUrl = trim(body.avatarUrl, AVATAR_MAX);

      // Verify post-update has at least one contact method.
      const finalEmail = "email" in data ? data.email : existing.email;
      const finalPhone = "phone" in data ? data.phone : existing.phone;
      if (!finalEmail && !finalPhone) {
        res.status(400).json({ success: false, error: "Recipient must keep at least one contact method." });
        return;
      }

      const updated = await prisma.sharingRecipient.update({ where: { id }, data });
      res.status(200).json({ success: true, data: { recipient: updated } });
    } catch (err: any) {
      console.error("[recipients/update] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update recipient." });
    }
  }),

  // ── DELETE /api/customer/recipients/:id ────────────────────
  remove: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
      const id = String(req.params.id || "");
      if (!id) { res.status(400).json({ success: false, error: "Missing recipient id." }); return; }

      const existing = await prisma.sharingRecipient.findFirst({
        where: { id, merchantId: userId }
      });
      if (!existing) { res.status(404).json({ success: false, error: "Recipient not found." }); return; }

      await prisma.sharingRecipient.delete({ where: { id } });
      res.status(200).json({ success: true, data: { deleted: id } });
    } catch (err: any) {
      console.error("[recipients/delete] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to delete recipient." });
    }
  })
};
