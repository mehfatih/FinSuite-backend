// ================================================================
// Zyrix FinSuite — Dijital Kartvizit Controller (Feature 11)
// Public profile: finsuite.zyrix.co/p/:slug
// ================================================================
import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";
import { Request } from "express";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

function slugify(text: string): string {
  return text.toLowerCase().replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const publicProfileController = {

  // ── GET /api/profile-page — kendi profilini getir
  get: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const profile = await prisma.publicProfile.findUnique({ where: { merchantId: req.merchant!.id } });
      res.json({ success: true, data: profile });
    } catch { res.status(500).json({ success: false, error: "Profil alınamadı" }); }
  }),

  // ── POST /api/profile-page — oluştur veya güncelle (upsert)
  upsert: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchantId = req.merchant!.id;
      const { displayName, tagline, description, phone, email, website, address, services, socialLinks, theme, isActive } = req.body;

      if (!displayName) return res.status(400).json({ success: false, error: "Görünen ad zorunlu" });

      // Slug oluştur
      let slug = req.body.slug || slugify(displayName);
      const existing = await prisma.publicProfile.findUnique({ where: { merchantId } });

      if (!existing) {
        // Benzersiz slug kontrol
        let finalSlug = slug;
        let counter = 1;
        while (await prisma.publicProfile.findUnique({ where: { slug: finalSlug } })) {
          finalSlug = `${slug}-${counter++}`;
        }
        const profile = await prisma.publicProfile.create({
          data: { merchantId, slug: finalSlug, displayName, tagline, description, phone, email, website, address, services: services || [], socialLinks: socialLinks || {}, theme: theme || "purple", isActive: isActive !== false },
        });
        // Merchant'a slug kaydet
        await prisma.merchant.update({ where: { id: merchantId }, data: { profileSlug: finalSlug, profileVisible: isActive !== false } });
        return res.status(201).json({ success: true, data: profile, profileUrl: `https://finsuite.zyrix.co/p/${finalSlug}` });
      }

      const profile = await prisma.publicProfile.update({
        where: { merchantId },
        data: { displayName, tagline, description, phone, email, website, address, ...(services !== undefined && { services }), ...(socialLinks !== undefined && { socialLinks }), ...(theme && { theme }), ...(isActive !== undefined && { isActive }) },
      });
      await prisma.merchant.update({ where: { id: merchantId }, data: { profileVisible: profile.isActive } });
      res.json({ success: true, data: profile, profileUrl: `https://finsuite.zyrix.co/p/${profile.slug}` });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: "Profil kaydedilemedi" });
    }
  }),

  // ── GET /p/:slug — public endpoint (JWT yok)
  viewPublic: h(async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const profile = await prisma.publicProfile.findUnique({ where: { slug } });
      if (!profile || !profile.isActive) return res.status(404).json({ success: false, error: "Profil bulunamadı" });
      // View count artır
      await prisma.publicProfile.update({ where: { slug }, data: { viewCount: { increment: 1 } } });
      res.json({ success: true, data: profile });
    } catch { res.status(500).json({ success: false, error: "Profil alınamadı" }); }
  }),

  // ── GET /api/profile-page/qr — QR kod URL üret
  qr: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const profile = await prisma.publicProfile.findUnique({ where: { merchantId: req.merchant!.id } });
      if (!profile) return res.status(404).json({ success: false, error: "Önce profil oluşturun" });
      const profileUrl = `https://finsuite.zyrix.co/p/${profile.slug}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(profileUrl)}`;
      res.json({ success: true, data: { profileUrl, qrUrl, slug: profile.slug } });
    } catch { res.status(500).json({ success: false, error: "QR üretilemedi" }); }
  }),
};