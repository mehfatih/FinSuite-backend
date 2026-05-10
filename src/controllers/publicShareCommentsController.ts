// ================================================================
// Sprint D-7 — Public share comment endpoints.
//
//   POST /api/public/share/:slug/comments  — post a new comment
//   GET  /api/public/share/:slug/comments  — list visible comments
//
// Public; the slug IS the credential. Spam prevention layers:
//   1. Honeypot field "website_url" (set by form, invisible to humans;
//      bots fill it → silent 200 OK so they don't learn).
//   2. Render-timestamp gate: form posts include the JS-side render
//      timestamp; rejects submissions <2s after render.
//   3. Per-IP-per-slug rate limit: 5 comments / hour.
//   4. Optional name+email gate (per share.requireEmail).
//   5. Body length cap (2000 chars).
//   6. Owner moderation (publicShareLinksController.hideComment).
//
// On success: persist row, increment share.commentCount, dispatch
// SHARE_EVENT notification to merchant via D-4 engine (decision §6.G).
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { hashRequestIp } from "../services/share/ipHash";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const MAX_BODY_LEN          = 2000;
const MAX_NAME_LEN          = 80;
const MAX_EMAIL_LEN         = 120;
const RENDER_GATE_MS        = 2000;          // submit must be at least 2s after render
const RATE_LIMIT_WINDOW_MS  = 60 * 60 * 1000;
const RATE_LIMIT_MAX        = 5;
const EMAIL_RE              = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Keyed by `${ipHash}:${slug}`. Bounded by JS heap; would migrate to
// Redis for V2 horizontal scaling.
interface RateBucket { ts: number[]; }
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(ipHash: string, slug: string): { ok: boolean; resetIn: number } {
  const key = `${ipHash}:${slug}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { ts: [] };
  // Drop stale entries.
  bucket.ts = bucket.ts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (bucket.ts.length >= RATE_LIMIT_MAX) {
    const oldest = bucket.ts[0] || now;
    return { ok: false, resetIn: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000) };
  }
  bucket.ts.push(now);
  rateBuckets.set(key, bucket);
  return { ok: true, resetIn: 0 };
}

function isExpired(share: { expiresAt: Date | null; permanent: boolean }): boolean {
  if (share.permanent) return false;
  if (!share.expiresAt) return false;
  return share.expiresAt.getTime() < Date.now();
}

// ─── Notification dispatch (lazy import; matches D-5/D-6 pattern) ──

async function fireCommentNotification(args: {
  merchantId: string;
  shareLinkId: string;
  commentId: string;
  authorName: string;
  bodyPreview: string;
  slug: string;
  language: string;
}): Promise<void> {
  try {
    const { dispatch } = await import("../services/notifications/engine");

    const titleByLang: Record<string, string> = {
      tr: "Yeni paylaşım yorumu",
      en: "New share comment",
      ar: "تعليق جديد على المشاركة"
    };
    const bodyByLang: Record<string, string> = {
      tr: `${args.authorName}: ${args.bodyPreview}`,
      en: `${args.authorName}: ${args.bodyPreview}`,
      ar: `${args.authorName}: ${args.bodyPreview}`
    };

    await dispatch({
      merchantId: args.merchantId,
      severity:   "SHARE_EVENT",
      type:       "share.comment_posted",
      title:      titleByLang[args.language] || titleByLang.tr,
      body:       bodyByLang[args.language]  || bodyByLang.tr,
      iconTone:   "cyan",
      ctaLabel:   "Görüntüle",
      ctaRoute:   `/insights/share-links?slug=${args.slug}`,
      shareId:    args.shareLinkId,
      data: {
        commentId:  args.commentId,
        slug:       args.slug,
        authorName: args.authorName
      }
    });
  } catch (err: any) {
    console.error("[publicShare/comment] notification dispatch failed:", err?.message || err);
  }
}

// ─── Controller ─────────────────────────────────────────────

export const publicShareCommentsController = {

  // POST /api/public/share/:slug/comments
  post: h(async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.params.slug || "");
    if (!slug || slug.length > 64) {
      res.status(404).json({ ok: false, error: "share_not_found" });
      return;
    }

    const body = req.body || {};

    // Honeypot — silent success so bots don't learn.
    if (typeof body.website_url === "string" && body.website_url.length > 0) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // Render-timestamp gate.
    const renderedAt = Number(body.renderedAt);
    if (Number.isFinite(renderedAt) && renderedAt > 0 && Date.now() - renderedAt < RENDER_GATE_MS) {
      // Looks scripted — silent success.
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    // Look up share + visibility checks.
    const share = await prisma.publicShareLink.findUnique({
      where: { slug },
      select: {
        id: true, merchantId: true, allowComments: true, requireEmail: true,
        revoked: true, expiresAt: true, permanent: true
      }
    }).catch(() => null);
    if (!share || share.revoked) {
      res.status(404).json({ ok: false, error: "share_not_found" });
      return;
    }
    if (isExpired(share)) {
      res.status(410).json({ ok: false, error: "share_expired" });
      return;
    }
    if (!share.allowComments) {
      res.status(403).json({ ok: false, error: "comments_disabled" });
      return;
    }

    // Field validation.
    const authorName = String(body.authorName || "").trim().slice(0, MAX_NAME_LEN);
    if (!authorName) {
      res.status(400).json({ ok: false, error: "name_required" });
      return;
    }
    const rawEmail = body.authorEmail === null || body.authorEmail === undefined
      ? "" : String(body.authorEmail || "").trim();
    let authorEmail: string | null = null;
    if (rawEmail) {
      if (rawEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(rawEmail)) {
        res.status(400).json({ ok: false, error: "invalid_email" });
        return;
      }
      authorEmail = rawEmail;
    }
    if (share.requireEmail && !authorEmail) {
      res.status(400).json({ ok: false, error: "email_required" });
      return;
    }
    const bodyText = String(body.body || "").trim();
    if (!bodyText) {
      res.status(400).json({ ok: false, error: "body_required" });
      return;
    }
    if (bodyText.length > MAX_BODY_LEN) {
      res.status(400).json({ ok: false, error: "body_too_long" });
      return;
    }

    // Optional parent (1-level depth enforced).
    let parentId: string | null = null;
    if (typeof body.parentId === "string" && body.parentId.length > 0) {
      const parent = await prisma.shareComment.findUnique({
        where: { id: body.parentId },
        select: { id: true, shareLinkId: true, parentId: true }
      });
      if (!parent || parent.shareLinkId !== share.id) {
        res.status(400).json({ ok: false, error: "invalid_parent" });
        return;
      }
      if (parent.parentId) {
        // Reject reply-to-reply (1-level deep per spec §6.H).
        res.status(400).json({ ok: false, error: "max_thread_depth" });
        return;
      }
      parentId = parent.id;
    }

    // Rate limit (per IP per slug).
    const ipHash = hashRequestIp(req);
    const rl = rateLimit(ipHash, slug);
    if (!rl.ok) {
      res.status(429).json({ ok: false, error: "rate_limited", waitSeconds: rl.resetIn });
      return;
    }

    // Persist.
    let comment;
    try {
      comment = await prisma.shareComment.create({
        data: {
          shareLinkId: share.id,
          parentId,
          authorName,
          authorEmail,
          body:        bodyText,
          ipHash
        }
      });
      await prisma.publicShareLink.update({
        where: { id: share.id },
        data:  { commentCount: { increment: 1 } }
      });
    } catch (err: any) {
      console.error("[publicShare/comment.post] insert failed:", err?.message || err);
      res.status(500).json({ ok: false, error: "comment_save_failed" });
      return;
    }

    // Notify merchant via D-4 engine (lazy import; non-blocking).
    const merchant = await prisma.merchant.findUnique({
      where: { id: share.merchantId }, select: { language: true }
    }).catch(() => null);
    const language = String(merchant?.language || "TR").toLowerCase();
    void fireCommentNotification({
      merchantId:  share.merchantId,
      shareLinkId: share.id,
      commentId:   comment.id,
      authorName:  comment.authorName,
      bodyPreview: bodyText.slice(0, 120),
      slug,
      language
    });

    res.status(201).json({
      ok: true,
      comment: {
        id:         comment.id,
        parentId:   comment.parentId,
        authorName: comment.authorName,
        body:       comment.body,
        createdAt:  comment.createdAt
      }
    });
  }),

  // GET /api/public/share/:slug/comments — public list (for SPA hydration)
  list: h(async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.params.slug || "");
    if (!slug || slug.length > 64) { res.status(404).json({ ok: false, error: "share_not_found" }); return; }

    const share = await prisma.publicShareLink.findUnique({
      where:  { slug },
      select: { id: true, allowComments: true, revoked: true, expiresAt: true, permanent: true }
    }).catch(() => null);
    if (!share || share.revoked) { res.status(404).json({ ok: false, error: "share_not_found" }); return; }
    if (isExpired(share))         { res.status(410).json({ ok: false, error: "share_expired" }); return; }
    if (!share.allowComments)     { res.json({ ok: true, comments: [] }); return; }

    const flat = await prisma.shareComment.findMany({
      where:   { shareLinkId: share.id, hidden: false },
      orderBy: { createdAt: "desc" },
      take:    100,
      select:  { id: true, parentId: true, authorName: true, body: true, createdAt: true }
    });
    res.json({ ok: true, comments: flat });
  })
};
