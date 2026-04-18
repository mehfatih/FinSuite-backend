import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

export const profileController = {

  // GET /api/profile
  get: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: req.merchant!.id },
        select: {
          id: true, name: true, email: true, phone: true,
          businessName: true, businessType: true, country: true,
          language: true, currency: true, timezone: true,
          onboardingDone: true, trialEndsAt: true, status: true, plan: true,
          merchantId: true, createdAt: true,
        },
      });
      if (!merchant) { res.status(404).json({ success: false, error: "Not found" }); return; }
      res.json({ success: true, data: merchant });
    } catch { res.status(500).json({ success: false, error: "Failed" }); }
  }),

  // PUT /api/profile
  update: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, businessName, businessType, country, language, currency, timezone, phone } = req.body;
      const merchant = await prisma.merchant.update({
        where: { id: req.merchant!.id },
        data: {
          ...(name         && { name }),
          ...(businessName && { businessName }),
          ...(businessType && { businessType }),
          ...(country      && { country }),
          ...(language     && { language }),
          ...(currency     && { currency }),
          ...(timezone     && { timezone }),
          ...(phone        && { phone }),
        },
        select: {
          id: true, name: true, email: true, phone: true,
          businessName: true, businessType: true, country: true,
          language: true, currency: true, timezone: true,
          onboardingDone: true, status: true, plan: true,
        },
      });
      res.json({ success: true, data: merchant });
    } catch { res.status(500).json({ success: false, error: "Update failed" }); }
  }),

  // POST /api/profile/onboarding — mark onboarding done
  completeOnboarding: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { businessName, businessType, country, currency, language } = req.body;
      const merchant = await prisma.merchant.update({
        where: { id: req.merchant!.id },
        data: {
          onboardingDone: true,
          ...(businessName && { businessName }),
          ...(businessType && { businessType }),
          ...(country      && { country }),
          ...(currency     && { currency }),
          ...(language     && { language }),
        },
        select: { id: true, name: true, onboardingDone: true },
      });
      res.json({ success: true, data: merchant });
    } catch { res.status(500).json({ success: false, error: "Onboarding failed" }); }
  }),
};