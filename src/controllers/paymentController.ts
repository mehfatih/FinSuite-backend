// ================================================================
// Zyrix FinSuite — Payment Controller (Production Ready)
// getPlans + getSubscription + initiate + iyzico Sandbox/Production
// ================================================================
import { Request, Response, RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest } from '../types';

const prisma = new PrismaClient();
const h = (fn: Function): RequestHandler => fn as RequestHandler;

// ── iyzico Config ─────────────────────────────────────────────
function getIyzicoConfig() {
  const apiKey    = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const baseUrl   = process.env.IYZICO_BASE_URL || 'https://sandbox.iyzipay.com';
  if (!apiKey || !secretKey) return null;
  const Iyzipay = require('iyzipay');
  return new Iyzipay({ apiKey, secretKey, uri: baseUrl });
}

const isProduction = process.env.IYZICO_BASE_URL === 'https://api.iyzipay.com';

// ── Plan Definitions ──────────────────────────────────────────
const PLANS = [
  {
    id: 'STARTER', name: 'Starter', price: 0, currency: 'TRY', interval: 'MONTHLY',
    features: ['5 fatura/ay', '50 müşteri', 'Temel CRM', 'E-Fatura (sandbox)'],
    recommended: false,
  },
  {
    id: 'BUSINESS', name: 'Business', price: 299, currency: 'TRY', interval: 'MONTHLY',
    features: ['Sınırsız fatura', '500 müşteri', 'AI Asistan', 'Stok yönetimi', 'WhatsApp', 'Taksit takibi'],
    recommended: true,
  },
  {
    id: 'PRO', name: 'Pro', price: 599, currency: 'TRY', interval: 'MONTHLY',
    features: ['Sınırsız her şey', 'E-Fatura (GİB)', 'Pazar Yeri', 'Muhasebeci erişimi', 'Ekip üyeleri', 'Benchmark'],
    recommended: false,
  },
  {
    id: 'ENTERPRISE', name: 'Enterprise', price: 0, currency: 'TRY', interval: 'MONTHLY',
    features: ["Pro'nun tümü", 'Özel entegrasyonlar', 'Dedicated destek', 'SLA garantisi'],
    recommended: false, contactSales: true,
  },
];

// ── GET /api/payments/plans ────────────────────────────────────
export const getPlans = h(async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { plans: PLANS, paymentMode: isProduction ? 'production' : 'sandbox', currency: 'TRY' },
  });
});

// ── GET /api/payments/subscription ────────────────────────────
export const getSubscription = h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;

    const subscription = await prisma.subscription.findFirst({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { plan: true, status: true, trialEndsAt: true },
    });

    if (!subscription) {
      return res.json({
        success: true,
        data: {
          plan: merchant?.plan || 'STARTER',
          status: 'TRIAL',
          trialEndsAt: merchant?.trialEndsAt,
          currentPeriodEnd: null,
          isTrial: true,
        },
      });
    }

    const currentPlan = PLANS.find(p => p.id === subscription.planName) || PLANS[0];

    res.json({
      success: true,
      data: {
        id:                 subscription.id,
        plan:               subscription.planName,
        planDetails:        currentPlan,
        status:             subscription.status,
        interval:           subscription.interval,
        amount:             Number(subscription.amount),
        currency:           subscription.currency,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd:   subscription.currentPeriodEnd,
        cancelledAt:        subscription.cancelledAt,
        isTrial:            subscription.status === 'TRIAL',
        trialEndsAt:        merchant?.trialEndsAt,
        merchantStatus:     merchant?.status,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Abonelik bilgisi alınamadı' });
  }
});

// ── POST /api/payments/initiate ────────────────────────────────
export const initiate = h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const merchant = req.merchant!;
    const { planId, paymentCard, interval = 'MONTHLY' } = req.body;

    if (!planId) return res.status(400).json({ success: false, error: 'Plan seçimi zorunlu' });

    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return res.status(400).json({ success: false, error: 'Geçersiz plan' });

    // ── Ücretsiz plan ─────────────────────────────────────────
    if (plan.price === 0) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await prisma.subscription.create({
        data: {
          merchantId: merchant.id, planName: planId as any, amount: 0,
          currency: 'TRY', interval: interval as any, status: 'ACTIVE',
          currentPeriodStart: new Date(), currentPeriodEnd: periodEnd,
        },
      });
      await prisma.merchant.update({ where: { id: merchant.id }, data: { plan: planId as any, status: 'ACTIVE' } });

      return res.json({
        success: true,
        data: { plan: planId, status: 'ACTIVE', amount: 0 },
        message: `${plan.name} planına geçildi`,
      });
    }

    // ── Sandbox mod (credentials yok) ─────────────────────────
    const iyzipay = getIyzicoConfig();
    if (!iyzipay) {
      console.log(`[Payment] Sandbox — simulating ${planId} for ${merchant.email}`);
      const periodEnd = new Date();
      if (interval === 'YEARLY') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await prisma.subscription.create({
        data: {
          merchantId: merchant.id, planName: planId as any, amount: plan.price,
          currency: 'TRY', interval: interval as any, status: 'ACTIVE',
          currentPeriodStart: new Date(), currentPeriodEnd: periodEnd,
        },
      });
      await prisma.merchant.update({ where: { id: merchant.id }, data: { plan: planId as any, status: 'ACTIVE' } });

      return res.json({
        success: true,
        data: { plan: planId, status: 'ACTIVE', amount: plan.price, mode: 'sandbox' },
        message: `${plan.name} planı aktif edildi (sandbox — IYZICO_API_KEY eklenince gerçek ödeme alınır)`,
      });
    }

    // ── Gerçek iyzico ödemesi ─────────────────────────────────
    if (!paymentCard) return res.status(400).json({ success: false, error: 'Kart bilgileri zorunlu' });

    const request = {
      locale: 'tr',
      conversationId: `sub-${merchant.id}-${Date.now()}`,
      price: String(plan.price), paidPrice: String(plan.price),
      currency: 'TRY', installment: '1',
      basketId: `plan-${planId}-${Date.now()}`,
      paymentChannel: 'WEB', paymentGroup: 'SUBSCRIPTION',
      paymentCard: {
        cardHolderName: paymentCard.cardHolderName,
        cardNumber:     paymentCard.cardNumber,
        expireMonth:    paymentCard.expireMonth,
        expireYear:     paymentCard.expireYear,
        cvc:            paymentCard.cvc,
        registerCard:   '0',
      },
      buyer: {
        id: merchant.id, name: merchant.name, surname: '',
        gsmNumber: merchant.phone, email: merchant.email,
        identityNumber: '11111111111', registrationAddress: 'Türkiye',
        ip: req.ip || '85.34.78.112', city: 'Istanbul', country: 'Turkey',
      },
      shippingAddress: { contactName: merchant.name, city: 'Istanbul', country: 'Turkey', address: 'Türkiye' },
      billingAddress:  { contactName: merchant.name, city: 'Istanbul', country: 'Turkey', address: 'Türkiye' },
      basketItems: [{
        id: `plan-${planId}`, name: `Zyrix FinSuite ${plan.name} Abonelik`,
        category1: 'Abonelik', itemType: 'VIRTUAL', price: String(plan.price),
      }],
    };

    iyzipay.payment.create(request, async (err: any, result: any) => {
      if (err) {
        console.error('[iyzico] Payment error:', err);
        return res.status(500).json({ success: false, error: 'Ödeme başlatılamadı' });
      }

      if (result.status === 'success') {
        const periodEnd = new Date();
        if (interval === 'YEARLY') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        else periodEnd.setMonth(periodEnd.getMonth() + 1);

        await prisma.subscription.create({
          data: {
            merchantId: merchant.id, planName: planId as any, amount: plan.price,
            currency: 'TRY', interval: interval as any, status: 'ACTIVE',
            currentPeriodStart: new Date(), currentPeriodEnd: periodEnd,
          },
        });
        await prisma.merchant.update({ where: { id: merchant.id }, data: { plan: planId as any, status: 'ACTIVE' } });

        return res.json({
          success: true,
          data: { paymentId: result.paymentId, plan: planId, status: 'ACTIVE', amount: plan.price, periodEnd, mode: isProduction ? 'production' : 'sandbox' },
          message: `${plan.name} planı aktif edildi`,
        });
      }

      return res.status(400).json({ success: false, error: result.errorMessage || 'Ödeme başarısız', errorCode: result.errorCode });
    });

  } catch (err) {
    console.error('[Payment initiate]', err);
    res.status(500).json({ success: false, error: 'Ödeme hatası' });
  }
});

// ── Export ────────────────────────────────────────────────────
export const paymentController = {
  getPlans,
  getSubscription,
  initiate,
};
