// ================================================================
// Sprint D-7 — Public share link controller (HTML + OG image + view).
//
//   GET  /share/i/:slug                 — cinematic HTML page
//   POST /share/i/:slug                 — password form submit
//   GET  /og/share/:slug.png            — OG image PNG
//   POST /api/public/share/:slug/track  — record view (called from the
//                                         page's inline JS or omitted if
//                                         we count GET as a view directly)
//
// All public; no Authorization header. Slug IS the credential.
// Password-gated shares require the visitor to enter the password
// once; a short-lived signed cookie unlocks subsequent GETs for 24h.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { applyPrivacy, PrivacyMode, SourceInsight } from "../services/share/privacyRenderer";
import {
  renderShareHtml,
  renderExpiredHtml,
  renderRevokedHtml,
  renderNotFoundHtml,
  renderPasswordGateHtml,
  renderOgImageHtml,
  ShareRenderComment
} from "../services/share/publicShareTemplate";
import { renderOgImage } from "../services/share/ogImageRenderer";
import { hashRequestIp } from "../services/share/ipHash";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const APP_BASE_URL    = (process.env.APP_PUBLIC_URL || "https://finsuite.zyrix.co").replace(/\/$/, "");
const SHARE_BASE_URL  = `${APP_BASE_URL}/s`;
const API_BASE_URL    = (process.env.API_PUBLIC_URL || "https://finsuite-backend-production.up.railway.app").replace(/\/$/, "");
const UNLOCK_TTL_SEC  = 24 * 60 * 60;

// ─── Helpers ────────────────────────────────────────────────

type Locale = "tr" | "en" | "ar";

function pickLocale(req: Request, fallback: string): Locale {
  const q = String(req.query.lang || "").toLowerCase();
  if (q === "tr" || q === "en" || q === "ar") return q;
  const stored = String(req.headers["accept-language"] || "").toLowerCase();
  if (stored.startsWith("ar")) return "ar";
  if (stored.startsWith("en")) return "en";
  if (stored.startsWith("tr")) return "tr";
  const fb = (fallback || "tr").toLowerCase();
  if (fb === "tr" || fb === "en" || fb === "ar") return fb;
  return "tr";
}

function unlockCookieName(slug: string): string {
  return `share_unlock_${slug.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function signUnlockCookie(slug: string): string {
  return jwt.sign(
    { sub: `share-unlock:${slug}`, slug },
    env.jwtSecret,
    { expiresIn: UNLOCK_TTL_SEC } as any
  );
}

function verifyUnlockCookie(slug: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  try {
    const decoded: any = jwt.verify(cookieValue, env.jwtSecret);
    return String(decoded?.sub || "") === `share-unlock:${slug}`;
  } catch {
    return false;
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function setUnlockCookie(res: Response, name: string, value: string): void {
  res.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${UNLOCK_TTL_SEC}`
  );
}

function isExpired(share: { expiresAt: Date | null; permanent: boolean }): boolean {
  if (share.permanent) return false;
  if (!share.expiresAt) return false;
  return share.expiresAt.getTime() < Date.now();
}

// ─── Resource loader (V1: insight only; daily_brief / weekly_report
//                     scaffolding present, full renderers are V2) ───

async function loadInsightAsSourceInsight(insightId: string): Promise<SourceInsight | null> {
  const row = await prisma.insight.findUnique({
    where: { id: insightId },
    select: {
      id: true, type: true, title: true, body: true,
      numericRefs: true, language: true, ctaLabel: true, ctaRoute: true,
      status: true
    }
  });
  if (!row) return null;
  if (row.status === "ARCHIVED") return null;
  return {
    id:          row.id,
    type:        String(row.type),
    title:       row.title,
    body:        row.body,
    numericRefs: (row.numericRefs as any) ?? null,
    language:    row.language,
    ctaLabel:    row.ctaLabel,
    ctaRoute:    row.ctaRoute
  };
}

// ─── Async view + count update (fire-and-forget) ─────────────

function trackViewAsync(args: {
  shareLinkId: string;
  ipHash:      string;
  userAgent:   string | null;
  referer:     string | null;
  country:     string | null;
}): void {
  const now = new Date();
  Promise.resolve().then(async () => {
    try {
      // Dedup: same IP within last hour for same share = don't double-count.
      const recent = await prisma.shareView.findFirst({
        where:   { shareLinkId: args.shareLinkId, ipHash: args.ipHash, viewedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        select:  { id: true }
      });
      if (recent) {
        // Still update lastViewedAt so the merchant sees recency; skip count.
        await prisma.publicShareLink.update({
          where: { id: args.shareLinkId },
          data:  { lastViewedAt: now }
        });
        return;
      }
      await prisma.shareView.create({
        data: {
          shareLinkId: args.shareLinkId,
          ipHash:      args.ipHash,
          userAgent:   args.userAgent,
          referer:     args.referer,
          country:     args.country
        }
      });
      await prisma.publicShareLink.update({
        where: { id: args.shareLinkId },
        data:  { viewCount: { increment: 1 }, lastViewedAt: now }
      });
    } catch (err: any) {
      console.error("[publicShare/track] async failed:", err?.message || err);
    }
  });
}

// ─── Build comment tree (top-level + replies) ───────────────

async function loadCommentTree(shareLinkId: string): Promise<ShareRenderComment[]> {
  const flat = await prisma.shareComment.findMany({
    where:   { shareLinkId, hidden: false },
    orderBy: { createdAt: "desc" },
    take:    100
  });
  const byParent = new Map<string, ShareRenderComment[]>();
  const tops: ShareRenderComment[] = [];
  for (const c of flat) {
    const node: ShareRenderComment = {
      id:          c.id,
      parentId:    c.parentId,
      authorName:  c.authorName,
      authorEmail: c.authorEmail,
      body:        c.body,
      createdAt:   c.createdAt,
      hidden:      c.hidden,
      replies:     []
    };
    if (c.parentId) {
      const arr = byParent.get(c.parentId) || [];
      arr.push(node);
      byParent.set(c.parentId, arr);
    } else {
      tops.push(node);
    }
  }
  for (const top of tops) {
    top.replies = (byParent.get(top.id) || []).reverse();   // chronological under each top
  }
  return tops;
}

// ─── Public controller ──────────────────────────────────────

export const publicShareLinkController = {

  // GET /share/i/:slug — main HTML render
  showPage: h(async (req: Request, res: Response): Promise<void> => {
    const slug   = String(req.params.slug || "");
    const locale = pickLocale(req, "tr");

    if (!slug || slug.length > 64) {
      res.status(404).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }

    let share;
    try {
      share = await prisma.publicShareLink.findUnique({ where: { slug } });
    } catch (err: any) {
      console.error("[publicShare.showPage] DB lookup failed:", err?.message || err);
      res.status(500).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }

    if (!share || share.revoked) {
      res.status(404).type("text/html").send(
        share?.revoked
          ? renderRevokedHtml({ locale, appBaseUrl: APP_BASE_URL })
          : renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL })
      );
      return;
    }
    if (isExpired(share)) {
      res.status(410).type("text/html").send(renderExpiredHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }

    // Password gate (if set, check unlock cookie).
    if (share.passwordHash) {
      const cookieVal = readCookie(req, unlockCookieName(slug));
      if (!verifyUnlockCookie(slug, cookieVal)) {
        res.status(200).type("text/html").send(renderPasswordGateHtml({
          slug, locale,
          apiBaseUrl:   API_BASE_URL,
          shareBaseUrl: SHARE_BASE_URL,
          appBaseUrl:   APP_BASE_URL
        }));
        return;
      }
    }

    // V1: insight only. Scaffolding for daily_brief/weekly_report is
    // a future cleanup — render a not-found state for now.
    if (share.resourceType !== "insight") {
      res.status(404).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }

    const sourceInsight = await loadInsightAsSourceInsight(share.resourceId).catch(() => null);
    if (!sourceInsight) {
      res.status(404).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }

    // Need merchant name (anonymous mode redacts it inside privacy renderer).
    const merchant = await prisma.merchant.findUnique({
      where: { id: share.merchantId }, select: { name: true, businessName: true }
    });
    const merchantName = merchant?.businessName || merchant?.name || "—";

    const rendered = applyPrivacy({
      insight:      sourceInsight,
      mode:         share.privacyMode as PrivacyMode,
      merchantName
    });

    const comments = share.allowComments ? await loadCommentTree(share.id) : [];

    // Fire-and-forget view tracking.
    trackViewAsync({
      shareLinkId: share.id,
      ipHash:      hashRequestIp(req),
      userAgent:   String(req.headers["user-agent"] || "").slice(0, 256) || null,
      referer:     String(req.headers["referer"]    || "").slice(0, 256) || null,
      country:     String(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || "").slice(0, 8) || null
    });

    const html = renderShareHtml({
      share: {
        slug:          share.slug,
        privacyMode:   share.privacyMode as PrivacyMode,
        allowComments: share.allowComments,
        requireEmail:  share.requireEmail,
        expiresAt:     share.expiresAt,
        generatedAt:   share.createdAt
      },
      insight:      rendered,
      comments,
      locale,
      appBaseUrl:   APP_BASE_URL,
      apiBaseUrl:   API_BASE_URL,
      shareBaseUrl: SHARE_BASE_URL,
      signupUrl:    `${APP_BASE_URL}/register?ref=share-${encodeURIComponent(slug)}`
    });

    // Inject robots header dynamically for the discoverable opt-in.
    const robotsHeader = share.discoverable ? "index,follow" : "noindex,nofollow";
    res.setHeader("X-Robots-Tag", robotsHeader);
    res.status(200).type("text/html").send(html);
  }),

  // POST /share/i/:slug — password verification
  verifyPassword: h(async (req: Request, res: Response): Promise<void> => {
    const slug   = String(req.params.slug || "");
    const locale = pickLocale(req, "tr");
    const password = String((req.body || {}).password || "");

    if (!slug) { res.status(404).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL })); return; }

    const share = await prisma.publicShareLink.findUnique({ where: { slug } }).catch(() => null);
    if (!share || share.revoked) {
      res.status(404).type("text/html").send(renderNotFoundHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }
    if (isExpired(share)) {
      res.status(410).type("text/html").send(renderExpiredHtml({ locale, appBaseUrl: APP_BASE_URL }));
      return;
    }
    if (!share.passwordHash) {
      // No password set — just redirect to GET.
      res.redirect(303, `${SHARE_BASE_URL}/${encodeURIComponent(slug)}`);
      return;
    }

    const ok = await bcrypt.compare(password, share.passwordHash).catch(() => false);
    if (!ok) {
      res.status(401).type("text/html").send(renderPasswordGateHtml({
        slug, locale,
        apiBaseUrl:   API_BASE_URL,
        shareBaseUrl: SHARE_BASE_URL,
        appBaseUrl:   APP_BASE_URL,
        error:        true
      }));
      return;
    }

    setUnlockCookie(res, unlockCookieName(slug), signUnlockCookie(slug));
    res.redirect(303, `${SHARE_BASE_URL}/${encodeURIComponent(slug)}`);
  }),

  // GET /og/share/:slug.png — OG image
  ogImage: h(async (req: Request, res: Response): Promise<void> => {
    const raw    = String(req.params.slug || "");
    const slug   = raw.replace(/\.png$/i, "");
    const locale = pickLocale(req, "tr");

    if (!slug) { res.status(404).end(); return; }

    const share = await prisma.publicShareLink.findUnique({ where: { slug } }).catch(() => null);
    if (!share || share.revoked || isExpired(share) || share.resourceType !== "insight") {
      res.status(404).end();
      return;
    }

    const sourceInsight = await loadInsightAsSourceInsight(share.resourceId).catch(() => null);
    if (!sourceInsight) { res.status(404).end(); return; }

    const merchant = await prisma.merchant.findUnique({
      where: { id: share.merchantId }, select: { name: true, businessName: true }
    });
    const merchantName = merchant?.businessName || merchant?.name || "—";

    const rendered = applyPrivacy({
      insight:      sourceInsight,
      mode:         share.privacyMode as PrivacyMode,
      merchantName
    });

    let png: Buffer;
    try {
      const html = renderOgImageHtml({ insight: rendered, locale });
      png = await renderOgImage({ html });
    } catch (err: any) {
      console.error("[publicShare.ogImage] render failed:", err?.message || err);
      res.status(503).end();
      return;
    }

    res.setHeader("Content-Type",  "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("X-Robots-Tag",  share.discoverable ? "index,follow" : "noindex,nofollow");
    res.status(200).end(png);
  }),

  // POST /api/public/share/:slug/track — explicit view ping (kept for
  // use-cases where the page is rendered with a CDN cache that masks
  // the GET; calls trackViewAsync the same way).
  track: h(async (req: Request, res: Response): Promise<void> => {
    const slug = String(req.params.slug || "");
    const share = await prisma.publicShareLink.findUnique({
      where: { slug }, select: { id: true, revoked: true, expiresAt: true, permanent: true }
    }).catch(() => null);
    if (!share || share.revoked || isExpired(share)) {
      res.status(404).json({ ok: false, error: "share_not_found" });
      return;
    }
    trackViewAsync({
      shareLinkId: share.id,
      ipHash:      hashRequestIp(req),
      userAgent:   String(req.headers["user-agent"] || "").slice(0, 256) || null,
      referer:     String(req.headers["referer"]    || "").slice(0, 256) || null,
      country:     String(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || "").slice(0, 8) || null
    });
    res.status(202).json({ ok: true });
  })
};
