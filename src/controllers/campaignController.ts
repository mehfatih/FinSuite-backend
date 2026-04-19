import { Request, Response } from 'express';
import { PrismaClient, CampaignStatus } from '@prisma/client';
import { Resend } from 'resend';

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// ─── GET /api/campaigns ────────────────────────────────────
export const getCampaigns = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch {
    res.status(500).json({ error: 'Kampanyalar alınamadı' });
  }
};

// ─── POST /api/campaigns ───────────────────────────────────
export const createCampaign = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { name, type, subject, body, discountPercent, startDate, endDate, targetSegment } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'İsim ve kampanya türü gereklidir' });
  }

  try {
    const campaign = await prisma.campaign.create({
      data: {
        merchantId: merchant.id,
        name,
        type,
        subject: subject || null,
        body: body || null,       // yeni alan
        content: body || null,    // eski alan — ikisini de doldur
        targetSegment: targetSegment || 'ALL',
        discountPercent: discountPercent ? Number(discountPercent) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: CampaignStatus.DRAFT,
      },
    });
    res.status(201).json(campaign);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kampanya oluşturulamadı' });
  }
};

// ─── POST /api/campaigns/:id/send ─────────────────────────
export const sendCampaign = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, merchantId: merchant.id },
    });
    if (!campaign) return res.status(404).json({ error: 'Kampanya bulunamadı' });
    if (campaign.status === CampaignStatus.COMPLETED) {
      return res.status(400).json({ error: 'Kampanya zaten gönderildi' });
    }

    const customers = await prisma.customer.findMany({
      where: { merchantId: merchant.id },
    });

    const messageBody = campaign.body || campaign.content || '';

    if (campaign.type === 'EMAIL' && campaign.subject && messageBody) {
      const emailsSent: string[] = [];

      for (const customer of customers) {
        if (!customer.email) continue;
        try {
          await resend.emails.send({
            from: 'Zyrix FinSuite <noreply@zyrix.co>',
            to: customer.email,
            subject: campaign.subject,
            html: `
<div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:32px 40px">
      <div style="font-size:22px;font-weight:800;color:#fff">Zyrix <span style="color:#38bdf8">FinSuite</span></div>
    </div>
    <div style="padding:40px">
      <p style="font-size:14px;color:#0f172a;line-height:1.8">${messageBody.replace(/\n/g, '<br>')}</p>
      ${campaign.discountPercent ? `
      <div style="text-align:center;margin:32px 0">
        <div style="display:inline-block;background:#f0fdf4;border:2px dashed #16a34a;border-radius:12px;padding:16px 32px">
          <div style="font-size:12px;color:#16a34a;font-weight:600;margin-bottom:4px">ÖZEL İNDİRİM</div>
          <div style="font-size:36px;font-weight:800;color:#16a34a">%${campaign.discountPercent}</div>
        </div>
      </div>` : ''}
    </div>
  </div>
</div>`,
          });
          emailsSent.push(customer.email);
        } catch {}
      }

      await prisma.campaign.update({
        where: { id },
        data: { status: CampaignStatus.COMPLETED, sentAt: new Date(), sentCount: emailsSent.length },
      });

      return res.json({ message: `Kampanya ${emailsSent.length} kişiye gönderildi`, sentCount: emailsSent.length });
    }

    // EMAIL olmayan türler
    await prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.COMPLETED, sentAt: new Date(), sentCount: customers.length },
    });

    res.json({ message: 'Kampanya tamamlandı', sentCount: customers.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gönderme başarısız' });
  }
};

// ─── PATCH /api/campaigns/:id ─────────────────────────────
export const updateCampaign = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { id } = req.params;
  const { name, subject, body, discountPercent, startDate, endDate } = req.body;

  try {
    const campaign = await prisma.campaign.findFirst({ where: { id, merchantId: merchant.id } });
    if (!campaign) return res.status(404).json({ error: 'Bulunamadı' });

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(subject !== undefined && { subject }),
        ...(body !== undefined && { body, content: body }),  // iki alanı da güncelle
        ...(discountPercent !== undefined && { discountPercent: Number(discountPercent) }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
      },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Güncelleme başarısız' });
  }
};

// ─── DELETE /api/campaigns/:id ────────────────────────────
export const deleteCampaign = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { id } = req.params;

  try {
    const campaign = await prisma.campaign.findFirst({ where: { id, merchantId: merchant.id } });
    if (!campaign) return res.status(404).json({ error: 'Bulunamadı' });

    await prisma.campaign.delete({ where: { id } });
    res.json({ message: 'Kampanya silindi' });
  } catch {
    res.status(500).json({ error: 'Silme başarısız' });
  }
};