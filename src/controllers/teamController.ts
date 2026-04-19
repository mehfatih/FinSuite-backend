import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

const VALID_ROLES = ['ADMIN', 'ACCOUNTANT', 'SALES', 'VIEWER', 'MEMBER'];

// ─── GET /api/team ─────────────────────────────────────────
export const getTeamMembers = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  try {
    const members = await prisma.teamMember.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, role: true,
        status: true, isActive: true, lastActiveAt: true, createdAt: true,
        // passwordHash ve inviteToken لا نرجعهم للـ frontend
      },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Ekip üyeleri alınamadı' });
  }
};

// ─── POST /api/team — Davet gönder ────────────────────────
export const inviteTeamMember = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { email, name, role } = req.body;

  if (!email || !role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Email ve geçerli bir rol gereklidir' });
  }

  try {
    const exists = await prisma.teamMember.findUnique({
      where: { merchantId_email: { merchantId: merchant.id, email } },
    });
    if (exists) return res.status(409).json({ error: 'Bu email zaten ekipte' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const member = await prisma.teamMember.create({
      data: {
        merchantId: merchant.id,
        email,
        name: name || email.split('@')[0],
        role,
        status: 'PENDING',
        isActive: false,
        inviteToken,
        inviteExpiry,
        permissions: {},
      },
    });

    const merchantInfo = await prisma.merchant.findUnique({ where: { id: merchant.id } });
    const inviteUrl = `${process.env.FRONTEND_URL || 'https://finsuite.zyrix.co'}/invite/${inviteToken}`;

    await resend.emails.send({
      from: 'Zyrix FinSuite <noreply@zyrix.co>',
      to: email,
      subject: `${merchantInfo?.businessName || merchantInfo?.name || 'Bir şirket'} sizi Zyrix FinSuite'e davet etti`,
      html: `
<div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:32px 40px">
      <div style="font-size:22px;font-weight:800;color:#fff">Zyrix <span style="color:#38bdf8">FinSuite</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">Ekip Daveti</div>
    </div>
    <div style="padding:40px">
      <p style="font-size:15px;color:#0f172a;margin-bottom:16px">Merhaba${name ? ` ${name}` : ''},</p>
      <p style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px">
        <strong>${merchantInfo?.businessName || merchantInfo?.name || 'Bir şirket'}</strong>, sizi Zyrix FinSuite ekibine 
        <strong>${role}</strong> rolüyle davet etti.
      </p>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${inviteUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px">Daveti Kabul Et</a>
      </div>
      <p style="font-size:12px;color:#94a3b8">Bu davet 7 gün geçerlidir.</p>
    </div>
  </div>
</div>`,
    });

    res.status(201).json({
      message: 'Davet gönderildi',
      member: { id: member.id, email: member.email, name: member.name, role: member.role, status: member.status },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Davet gönderilemedi' });
  }
};

// ─── POST /api/team/accept/:token — Daveti kabul et ───────
export const acceptInvite = async (req: Request, res: Response) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır' });
  }

  try {
    const member = await prisma.teamMember.findFirst({
      where: { inviteToken: token, status: 'PENDING', inviteExpiry: { gt: new Date() } },
    });
    if (!member) return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş davet' });

    const hashed = await bcrypt.hash(password, 10);
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { status: 'ACTIVE', isActive: true, passwordHash: hashed, inviteToken: null, inviteExpiry: null },
    });

    res.json({ message: 'Davet kabul edildi, giriş yapabilirsiniz' });
  } catch (err) {
    res.status(500).json({ error: 'İşlem başarısız' });
  }
};

// ─── PATCH /api/team/:id ──────────────────────────────────
export const updateTeamMember = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { id } = req.params;
  const { role, name, isActive } = req.body;

  try {
    const member = await prisma.teamMember.findFirst({
      where: { id, merchantId: merchant.id },
    });
    if (!member) return res.status(404).json({ error: 'Üye bulunamadı' });

    const updated = await prisma.teamMember.update({
      where: { id },
      data: {
        ...(role && { role }),
        ...(name && { name }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, isActive: updated.isActive });
  } catch (err) {
    res.status(500).json({ error: 'Güncelleme başarısız' });
  }
};

// ─── DELETE /api/team/:id ─────────────────────────────────
export const removeTeamMember = async (req: Request, res: Response) => {
  const merchant = (req as any).merchant;
  const { id } = req.params;

  try {
    const member = await prisma.teamMember.findFirst({
      where: { id, merchantId: merchant.id },
    });
    if (!member) return res.status(404).json({ error: 'Üye bulunamadı' });

    await prisma.teamMember.delete({ where: { id } });
    res.json({ message: 'Üye kaldırıldı' });
  } catch (err) {
    res.status(500).json({ error: 'Silme başarısız' });
  }
};