// ================================================================
// Zyrix FinSuite — iyzico Payment Controller (Production Ready)
// Sandbox + Production mode — auto-switches based on env vars
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

  if (!apiKey || !secretKey) {
    throw new Error('IYZICO_API_KEY ve IYZICO_SECRET_KEY eksik — Railway Variables kontrol edin');
  }

  const Iyzipay = require('iyzipay');
  return new Iyzipay({ apiKey, secretKey, uri: baseUrl });
}

const isProduction = process.env.IYZICO_BASE_URL === 'https://api.iyzipay.com';

// ── POST /api/payments/initialize — Ödeme başlat ──────────────
export const initializePayment = h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const iyzipay = getIyzicoConfig();
    const merchant = (req as any).merchant;
    const {
      price, paidPrice, currency = 'TRY',
      installment = 1, paymentCard,
      buyer, shippingAddress, billingAddress,
      basketItems, callbackUrl, invoiceId,
    } = req.body;

    if (!price || !paymentCard || !buyer) {
      return res.status(400).json({ success: false, error: 'Fiyat, kart bilgileri ve alıcı zorunlu' });
    }

    const request = {
      locale: 'tr',
      conversationId: `${merchant.id}-${Date.now()}`,
      price: String(price),
      paidPrice: String(paidPrice || price),
      currency,
      installment: String(installment),
      basketId: invoiceId || `basket-${Date.now()}`,
      paymentChannel: 'WEB',
      paymentGroup: 'PRODUCT',
      paymentCard: {
        cardHolderName: paymentCard.cardHolderName,
        cardNumber:     paymentCard.cardNumber,
        expireMonth:    paymentCard.expireMonth,
        expireYear:     paymentCard.expireYear,
        cvc:            paymentCard.cvc,
        registerCard:   paymentCard.registerCard || '0',
      },
      buyer: {
        id:                  buyer.id || merchant.id,
        name:                buyer.name || merchant.name,
        surname:             buyer.surname || '',
        gsmNumber:           buyer.gsmNumber || merchant.phone,
        email:               buyer.email || merchant.email,
        identityNumber:      buyer.identityNumber || '11111111111',
        registrationAddress: buyer.registrationAddress || 'Türkiye',
        ip:                  req.ip || '85.34.78.112',
        city:                buyer.city || 'Istanbul',
        country:             buyer.country || 'Turkey',
      },
      shippingAddress: shippingAddress || {
        contactName: buyer.name || merchant.name,
        city: 'Istanbul', country: 'Turkey',
        address: 'Türkiye',
      },
      billingAddress: billingAddress || {
        contactName: buyer.name || merchant.name,
        city: 'Istanbul', country: 'Turkey',
        address: 'Türkiye',
      },
      basketItems: basketItems || [{
        id:       invoiceId || 'item-1',
        name:     'Zyrix FinSuite Ödemesi',
        category1:'Abonelik',
        itemType: 'VIRTUAL',
        price:    String(price),
      }],
    };

    iyzipay.payment.create(request, async (err: any, result: any) => {
      if (err) {
        console.error('[iyzico] Payment error:', err);
        return res.status(500).json({ success: false, error: 'Ödeme başlatılamadı', detail: err.message });
      }

      if (result.status === 'success') {
        // Log başarılı ödeme
        console.log(`[iyzico] Payment success: ${result.paymentId} — ${price} ${currency}`);

        // Fatura varsa ödendi olarak işaretle
        if (invoiceId) {
          await prisma.invoice.updateMany({
            where: { id: invoiceId, merchantId: merchant.id },
            data: { status: 'PAID', paidDate: new Date() },
          }).catch(console.error);
        }

        return res.json({
          success: true,
          data: {
            paymentId:      result.paymentId,
            conversationId: result.conversationId,
            status:         result.status,
            fraudStatus:    result.fraudStatus,
            price:          result.price,
            paidPrice:      result.paidPrice,
            currency:       result.currency,
            installment:    result.installment,
            mode:           isProduction ? 'production' : 'sandbox',
          },
          message: 'Ödeme başarılı',
        });
      }

      // Başarısız
      console.error('[iyzico] Payment failed:', result.errorMessage);
      return res.status(400).json({
        success: false,
        error: result.errorMessage || 'Ödeme başarısız',
        errorCode: result.errorCode,
        errorGroup: result.errorGroup,
      });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Ödeme hatası' });
  }
});

// ── POST /api/payments/3ds/initialize — 3D Secure ─────────────
export const initialize3DS = h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const iyzipay = getIyzicoConfig();
    const merchant = (req as any).merchant;
    const { price, paymentCard, buyer, basketItems, callbackUrl, invoiceId } = req.body;

    const request = {
      locale: 'tr',
      conversationId: `3ds-${merchant.id}-${Date.now()}`,
      price: String(price),
      paidPrice: String(price),
      currency: 'TRY',
      installment: '1',
      basketId: invoiceId || `basket-${Date.now()}`,
      paymentChannel: 'WEB',
      paymentGroup: 'PRODUCT',
      callbackUrl: callbackUrl || `${process.env.FRONTEND_URL || 'https://finsuite.zyrix.co'}/payment/callback`,
      paymentCard: {
        cardHolderName: paymentCard.cardHolderName,
        cardNumber:     paymentCard.cardNumber,
        expireMonth:    paymentCard.expireMonth,
        expireYear:     paymentCard.expireYear,
        cvc:            paymentCard.cvc,
        registerCard:   '0',
      },
      buyer: {
        id:                  merchant.id,
        name:                buyer?.name || merchant.name,
        surname:             buyer?.surname || '',
        gsmNumber:           merchant.phone,
        email:               merchant.email,
        identityNumber:      buyer?.identityNumber || '11111111111',
        registrationAddress: 'Türkiye',
        ip:                  req.ip || '85.34.78.112',
        city:                'Istanbul',
        country:             'Turkey',
      },
      shippingAddress: { contactName: merchant.name, city: 'Istanbul', country: 'Turkey', address: 'Türkiye' },
      billingAddress:  { contactName: merchant.name, city: 'Istanbul', country: 'Turkey', address: 'Türkiye' },
      basketItems: basketItems || [{ id: 'item-1', name: 'Ödeme', category1: 'Hizmet', itemType: 'VIRTUAL', price: String(price) }],
    };

    iyzipay.threedsInitialize.create(request, (err: any, result: any) => {
      if (err) return res.status(500).json({ success: false, error: err.message });

      if (result.status === 'success') {
        // 3DS HTML sayfası döndür — müşteri bu sayfaya yönlendirilmeli
        return res.json({ success: true, data: { htmlContent: result.threeDSHtmlContent, conversationId: result.conversationId } });
      }

      res.status(400).json({ success: false, error: result.errorMessage });
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/payments/3ds/callback — 3D Secure callback ──────
export const callback3DS = h(async (req: Request, res: Response) => {
  try {
    const iyzipay = getIyzicoConfig();
    const { conversationId, mdStatus, paymentId } = req.body;

    iyzipay.threedsPayment.create({ locale: 'tr', conversationId, paymentId }, (err: any, result: any) => {
      const frontendUrl = process.env.FRONTEND_URL || 'https://finsuite.zyrix.co';

      if (err || result.status !== 'success') {
        return res.redirect(`${frontendUrl}/payment/failed?error=${encodeURIComponent(result?.errorMessage || 'Ödeme başarısız')}`);
      }

      res.redirect(`${frontendUrl}/payment/success?paymentId=${result.paymentId}`);
    });
  } catch (err: any) {
    res.redirect(`${process.env.FRONTEND_URL || 'https://finsuite.zyrix.co'}/payment/failed?error=server_error`);
  }
});

// ── GET /api/payments/installments — Taksit seçenekleri ───────
export const getInstallmentOptions = h(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const iyzipay = getIyzicoConfig();
    const { binNumber, price } = req.query;

    if (!binNumber || !price) {
      return res.status(400).json({ success: false, error: 'binNumber ve price zorunlu' });
    }

    iyzipay.installmentInfo.retrieve(
      { locale: 'tr', binNumber: String(binNumber), price: String(price) },
      (err: any, result: any) => {
        if (err || result.status !== 'success') {
          return res.status(400).json({ success: false, error: result?.errorMessage || 'Taksit bilgisi alınamadı' });
        }

        res.json({ success: true, data: result.installmentDetails });
      }
    );
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/payments/status — iyzico bağlantı durumu ─────────
export const getPaymentStatus = h(async (_req: Request, res: Response) => {
  const configured = !!(process.env.IYZICO_API_KEY && process.env.IYZICO_SECRET_KEY);
  res.json({
    success: true,
    data: {
      configured,
      mode: isProduction ? 'production' : 'sandbox',
      baseUrl: process.env.IYZICO_BASE_URL || 'https://sandbox.iyzipay.com',
    },
  });
});
