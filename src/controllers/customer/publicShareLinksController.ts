// ================================================================
// Sprint D-7 — Customer-side public share link CRUD.
//
//   GET    /api/customer/share-links                 — paginated list
//   POST   /api/customer/share-links                 — create new link
//   GET    /api/customer/share-links/:id             — single row + comments preview
//   PATCH  /api/customer/share-links/:id             — update privacy / expiry /
//                                                       password / toggles / revoke
//   DELETE /api/customer/share-links/:id             — soft revoke (revoked=true)
//   PATCH  /api/customer/share-links/:id/comments/:commentId
//                                                    — hide a comment (owner moderation)
//
// All authenticated; merchantId from req.merchant.id. Resource
// ownership is verified server-side on every create (never trust
// the client to know which insight belongs to which merchant).
// ================================================================
import { Request, Response, RequestHandler, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { generateUniqueSlug } from "../../services/share/slug";
import type { PrivacyMode } from "../../services/share/privacyRenderer";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_RESOURCE_TYPES = new Set(["insight", "daily_brief", "weekly_report"]);
const ALLOWED_PRIVACY_MODES  = new Set<PrivacyMode>(["full", "masked", "narrative_only", "anonymous"]);
const MAX_EXPIRY_DAYS = 365;
const PASSWORD_MIN_LEN = 4;
const PASSWORD_MAX_LEN = 64;

const PUBLIC_SHARE_BASE_URL =
  process.env.PUBLIC_SHARE_BASE_URL ||
  process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
  "https://finsuite.zyrix.co";

function shareUrl(slug: string, resourceType: string): string {
  const path = resourceType === "weekly_report" ? "r" : "i";
  return `${PUBLIC_SHARE_BASE_URL.replace(/\/$/, "")}/s/${encodeURIComponent(slug)}`;
  // Note: we keep a single /s/:slug rewrite (vercel.json) for V1 simplicity.
  // The path argument is reserved for future /r vs /i distinction if needed.
}

function payloadOf(row: any) {
  return {
    id:            row.id,
    slug:          row.slug,
    url:           shareUrl(row.slug, row.resourceType),
    resourceType:  row.resourceType,
    resourceId:    row.resourceId,
    privacyMode:   row.privacyMode,
    expiresAt:     row.expiresAt,
    permanent:     row.permanent,
    hasPassword:   !!row.passwordHash,
    allowComments: row.allowComments,
    requireEmail:  row.requireEmail,
    discoverable:  row.discoverable,
    viewCount:     row.viewCount,
    commentCount:  row.commentCount,
    lastViewedAt:  row.lastViewedAt,
    revoked:       row.revoked,
    revokedAt:     row.revokedAt,
    createdAt:     row.createdAt
  };
}

// ─── Resource ownership verification ─────────────────────────

async function verifyResourceOwnership(args: {
  merchantId: string; resourceType: string; resourceId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { merchantId, resourceType, resourceId } = args;
  try {
    if (resourceType === "insight") {
      const row = await prisma.insight.findFirst({
        where: { id: resourceId, merchantId },
        select: { id: true }
      });
      return { ok: !!row, reason: row ? undefined : "insight_not_found_or_not_yours" };
    }
    if (resourceType === "daily_brief") {
      // CustomerDailyBrief.customerUserId IS merchantId in this codebase.
      const row = await prisma.customerDailyBrief.findFirst({
        where: { id: resourceId, customerUserId: merchantId },
        select: { id: true }
      });
      return { ok: !!row, reason: row ? undefined : "daily_brief_not_found_or_not_yours" };
    }
    if (resourceType === "weekly_report") {
      const row = await prisma.weeklyReport.findFirst({
        where: { id: resourceId, merchantId },
        select: { id: true }
      });
      return { ok: !!row, reason: row ? undefined : "weekly_report_not_found_or_not_yours" };
    }
    return { ok: false, reason: "invalid_resource_type" };
  } catch (err: any) {
    console.error("[publicShareLinks/verifyResourceOwnership] error:", err?.message || err);
    return { ok: false, reason: "ownership_check_failed" };
  }
}

// ─── Controller ─────────────────────────────────────────────

export const publicShareLinksController = {

  // GET / — paginated list
  list: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    try {
      const limit  = Math.max(1, Math.min(50, parseInt(String(req.query.limit  ?? "20"), 10) || 20));
      const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const [rows, total] = await Promise.all([
        prisma.publicShareLink.findMany({
          where:   { merchantId },
          orderBy: { createdAt: "desc" },
          take:    limit,
          skip:    offset
        }),
        prisma.publicShareLink.count({ where: { merchantId } })
      ]);
      res.json({
        success: true,
        data: {
          shareLinks: rows.map(payloadOf),
          total, limit, offset
        }
      });
    } catch (err: any) {
      console.error("[publicShareLinks.list] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load share links" });
    }
  }),

  // POST / — create new link
  create: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const body = req.body || {};
    const resourceType = String(body.resourceType || "");
    const resourceId   = String(body.resourceId   || "");
    const privacyMode  = String(body.privacyMode  || "full") as PrivacyMode;

    if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
      res.status(400).json({ success: false, error: "invalid_resource_type" }); return;
    }
    if (!resourceId) {
      res.status(400).json({ success: false, error: "resource_id_required" }); return;
    }
    if (!ALLOWED_PRIVACY_MODES.has(privacyMode)) {
      res.status(400).json({ success: false, error: "invalid_privacy_mode" }); return;
    }

    // Ownership boundary — never let merchant share another merchant's resource.
    const ownership = await verifyResourceOwnership({ merchantId, resourceType, resourceId });
    if (!ownership.ok) {
      res.status(404).json({ success: false, error: ownership.reason || "resource_not_found" });
      return;
    }

    // Expiry handling.
    const permanent = body.permanent === true;
    let expiresAt: Date | null = null;
    if (!permanent && body.expiresAt) {
      const e = new Date(body.expiresAt);
      if (!Number.isFinite(e.getTime()) || e.getTime() <= Date.now()) {
        res.status(400).json({ success: false, error: "expiry_must_be_future" }); return;
      }
      const maxFuture = Date.now() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      if (e.getTime() > maxFuture) {
        res.status(400).json({ success: false, error: "expiry_max_one_year" }); return;
      }
      expiresAt = e;
    } else if (!permanent) {
      // Default: 30 days from now.
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    // Password (optional).
    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < PASSWORD_MIN_LEN || body.password.length > PASSWORD_MAX_LEN) {
        res.status(400).json({ success: false, error: "password_length_out_of_range" }); return;
      }
      passwordHash = await bcrypt.hash(body.password, 10);
    }

    const allowComments = body.allowComments !== false;     // default true
    const requireEmail  = body.requireEmail  === true;      // default false
    const discoverable  = body.discoverable  === true;      // default false (noindex)

    // Generate a unique slug (retries on collision via the existence check).
    let slug: string;
    try {
      slug = await generateUniqueSlug(async (candidate) => {
        const exists = await prisma.publicShareLink.findUnique({
          where: { slug: candidate }, select: { id: true }
        });
        return !!exists;
      });
    } catch (err: any) {
      console.error("[publicShareLinks.create] slug exhausted:", err?.message || err);
      res.status(500).json({ success: false, error: "slug_generation_failed" });
      return;
    }

    try {
      const row = await prisma.publicShareLink.create({
        data: {
          slug,
          merchantId,
          resourceType,
          resourceId,
          privacyMode,
          expiresAt,
          permanent,
          passwordHash,
          allowComments,
          requireEmail,
          discoverable,
          createdBy: merchantId
        }
      });
      res.status(201).json({ success: true, data: { shareLink: payloadOf(row) } });
    } catch (err: any) {
      console.error("[publicShareLinks.create] insert failed:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to create share link" });
    }
  }),

  // GET /:id
  getById: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    try {
      const row = await prisma.publicShareLink.findFirst({
        where: { id, merchantId }
      });
      if (!row) { res.status(404).json({ success: false, error: "share_link_not_found" }); return; }
      // Optional: include the latest 10 comments inline.
      const comments = await prisma.shareComment.findMany({
        where:   { shareLinkId: row.id, hidden: false },
        orderBy: { createdAt: "desc" },
        take:    10,
        select:  { id: true, parentId: true, authorName: true, authorEmail: true, body: true, createdAt: true, hidden: true }
      });
      res.json({ success: true, data: { shareLink: payloadOf(row), comments } });
    } catch (err: any) {
      console.error("[publicShareLinks.getById] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to load share link" });
    }
  }),

  // PATCH /:id
  update: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    const body = req.body || {};
    const patch: any = {};

    if (typeof body.privacyMode === "string") {
      if (!ALLOWED_PRIVACY_MODES.has(body.privacyMode as PrivacyMode)) {
        res.status(400).json({ success: false, error: "invalid_privacy_mode" }); return;
      }
      patch.privacyMode = body.privacyMode;
    }
    if (typeof body.allowComments === "boolean") patch.allowComments = body.allowComments;
    if (typeof body.requireEmail  === "boolean") patch.requireEmail  = body.requireEmail;
    if (typeof body.discoverable  === "boolean") patch.discoverable  = body.discoverable;
    if (typeof body.permanent     === "boolean") {
      patch.permanent = body.permanent;
      if (body.permanent === true) patch.expiresAt = null;
    }
    if (body.expiresAt !== undefined) {
      if (body.expiresAt === null) {
        patch.expiresAt = null;
      } else {
        const e = new Date(body.expiresAt);
        if (!Number.isFinite(e.getTime()) || e.getTime() <= Date.now()) {
          res.status(400).json({ success: false, error: "expiry_must_be_future" }); return;
        }
        const maxFuture = Date.now() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        if (e.getTime() > maxFuture) {
          res.status(400).json({ success: false, error: "expiry_max_one_year" }); return;
        }
        patch.expiresAt = e;
        patch.permanent = false;
      }
    }
    // Password change: empty string clears, non-empty rehashes.
    if (typeof body.password === "string") {
      if (body.password === "") {
        patch.passwordHash = null;
      } else {
        if (body.password.length < PASSWORD_MIN_LEN || body.password.length > PASSWORD_MAX_LEN) {
          res.status(400).json({ success: false, error: "password_length_out_of_range" }); return;
        }
        patch.passwordHash = await bcrypt.hash(body.password, 10);
      }
    }
    // Revoke can also be set via PATCH (mirror of DELETE for resource-style API).
    if (body.revoked === true) {
      patch.revoked = true;
      patch.revokedAt = new Date();
    } else if (body.revoked === false) {
      patch.revoked = false;
      patch.revokedAt = null;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: "no_valid_fields" }); return;
    }

    try {
      const row = await prisma.publicShareLink.updateMany({
        where: { id, merchantId },
        data:  patch
      });
      if (row.count === 0) { res.status(404).json({ success: false, error: "share_link_not_found" }); return; }
      const refreshed = await prisma.publicShareLink.findUnique({ where: { id } });
      res.json({ success: true, data: { shareLink: refreshed ? payloadOf(refreshed) : null } });
    } catch (err: any) {
      console.error("[publicShareLinks.update] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to update share link" });
    }
  }),

  // DELETE /:id — soft revoke (preserves analytics).
  revoke: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id = String(req.params.id || "");
    try {
      const result = await prisma.publicShareLink.updateMany({
        where: { id, merchantId },
        data:  { revoked: true, revokedAt: new Date() }
      });
      if (result.count === 0) { res.status(404).json({ success: false, error: "share_link_not_found" }); return; }
      res.json({ success: true, data: { revoked: true } });
    } catch (err: any) {
      console.error("[publicShareLinks.revoke] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to revoke share link" });
    }
  }),

  // PATCH /:id/comments/:commentId — hide a comment (owner moderation)
  hideComment: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }
    const id        = String(req.params.id || "");
    const commentId = String(req.params.commentId || "");
    const reason    = String((req.body || {}).reason || "owner_hidden").slice(0, 64);
    try {
      // Verify share belongs to merchant first.
      const share = await prisma.publicShareLink.findFirst({
        where: { id, merchantId }, select: { id: true }
      });
      if (!share) { res.status(404).json({ success: false, error: "share_link_not_found" }); return; }
      const result = await prisma.shareComment.updateMany({
        where: { id: commentId, shareLinkId: id },
        data:  { hidden: true, hiddenReason: reason }
      });
      if (result.count === 0) { res.status(404).json({ success: false, error: "comment_not_found" }); return; }
      res.json({ success: true, data: { hidden: true } });
    } catch (err: any) {
      console.error("[publicShareLinks.hideComment] error:", err?.message || err);
      res.status(500).json({ success: false, error: "Failed to hide comment" });
    }
  })
};
