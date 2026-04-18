import { Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { AuthenticatedRequest } from "../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── iyzico API helper ─────────────────────────────
async function iyzicoRequest(endpoint: string, body: object) {
  const Iyzipay = require("iyzipay");
  const iyzipay = new Iyzipay({
    apiKey:    env.iyzicoApiKey,
    secretKey: env.iyzicoSecretKey,
    uri:       env.iyzicoBaseUrl, // https://sandbox.iyzipay.com or https://api.iyzipay.com
  });
  return new Promise((resolve, reject) => {
    (iyzipay as any)[endpoint].create(body, (err: any, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

const PLAN_PRICES: Record<string, number> = {
  STARTER:    499,
  BUSINESS:   999,
  PRO:       1999,
  ENTERPRISE: 4999,
};

export const paymentController = {

  // POST /api/payments/initiate — start iyzico checkout
  initiate: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { plan, cardHolderName, cardNumber, expireMonth, expireYear, cvc } = req.body;
      const merchant = await prisma.merchant.findUnique({
        where: { id: req.merchant!.id },
        select: { id: true, name: true, email: true, phone: true, country: true },
      });
      if (!merchant) { res.status(404).json({ success: false, error: "Merchant not found" }); return; }

      const price = PLAN_PRICES[plan];
      if (!price) { res.status(400).json({ success: false, error: "Invalid plan" }); return; }

      const request = {
        locale: "tr",
        conversationId: `${merchant.id}-${Date.now()}`,
        price: price.toString(),
        paidPrice: price.toString(),
        currency: "TRY",
        installment: "1",
        basketId: `basket-${merchant.id}`,
        paymentChannel: "WEB",
        paymentGroup: "SUBSCRIPTION",
        paymentCard: {
          cardHolderName,
          cardNumber: cardNumber.replace(/\s/g, ""),
          expireMonth,
          expireYear,
          cvc,
          registerCard: "0",
        },
        buyer: {
          id: merchant.id,
          name: merchant.name.split(" ")[0] || "Ad",
          surname: merchant.name.split(" ").slice(1).join(" ") || "Soyad",
          email: merchant.email,
          identityNumber: "11111111111",
          registrationAddress: merchant.country || "TR",
          city: merchant.country || "Istanbul",
          country: "Turkey",
          ip: req.ip || "85.34.78.112",
        },
        shippingAddress: {
          contactName: merchant.name,
          city: "Istanbul",
          country: "Turkey",
          address: merchant.country || "TR",
        },
        billingAddress: {
          contactName: merchant.name,
          city: "Istanbul",
          country: "Turkey",
          address: merchant.country || "TR",
        },
        basketItems: [{
          id: `plan-${plan}`,
          name: `Zyrix FinSuite ${plan} Plan`,
          category1: "SaaS Subscription",
          itemType: "VIRTUAL",
          price: price.toString(),
        }],
      };

      const result: any = await iyzicoRequest("payment", request);

      if (result.status === "success") {
        // Update subscription
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await prisma.merchant.update({
          where: { id: merchant.id },
          data: { status: "ACTIVE", plan: plan as any },
        });

        await prisma.subscription.create({
          data: {
            merchantId: merchant.id,
            planName: plan as any,
            amount: price,
            currency: "TRY",
            interval: "MONTHLY",
            status: "ACTIVE",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

        // Create success notification
        await prisma.notification.create({
          data: {
            merchantId: merchant.id,
            title: "Abonelik Aktif! 🎉",
            body: `${plan} planınız başarıyla aktifleştirildi. Bir sonraki ödeme tarihi: ${periodEnd.toLocaleDateString("tr-TR")}`,
            type: "SUCCESS",
          },
        });

        res.json({ success: true, data: { message: "Ödeme başarılı", plan, periodEnd } });
      } else {
        res.status(400).json({ success: false, error: result.errorMessage || "Ödeme başarısız" });
      }
    } catch (err: any) {
      console.error("iyzico error:", err);
      res.status(500).json({ success: false, error: "Ödeme işlemi başarısız" });
    }
  }),

  // GET /api/payments/plans — get available plans
  getPlans: h(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      success: true,
      data: [
        {
          id: "STARTER", name: "Starter", price: 499, currency: "TRY",
          features: ["500 fatura/ay", "1.000 müşteri", "Temel CRM", "E-posta desteği"],
        },
        {
          id: "BUSINESS", name: "Business", price: 999, currency: "TRY", popular: true,
          features: ["Sınırsız fatura", "10.000 müşteri", "Gelişmiş CRM", "AI analitiği", "Öncelikli destek"],
        },
        {
          id: "PRO", name: "Pro", price: 1999, currency: "TRY",
          features: ["Sınırsız her şey", "Tam AI suite", "7/24 destek", "API erişimi"],
        },
      ],
    });
  }),

  // GET /api/payments/subscription — current subscription
  getSubscription: h(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sub = await prisma.subscription.findFirst({
        where: { merchantId: req.merchant!.id },
        orderBy: { createdAt: "desc" },
      });
      const merchant = await prisma.merchant.findUnique({
        where: { id: req.merchant!.id },
        select: { status: true, plan: true, trialEndsAt: true },
      });
      res.json({ success: true, data: { subscription: sub, merchant } });
    } catch { res.status(500).json({ success: false, error: "Failed" }); }
  }),
};