// ================================================================
// Phase 13 — Security routes (2FA, sessions, audit log, KVKK exports).
// 2FA secrets encrypted with AES-256-GCM via utils/encryption.ts.
// ================================================================
import { Router, Response } from "express";
import crypto from "crypto";
import { prisma } from "../config/database";
import { authenticate } from "../middleware/auth";
import { AuthenticatedRequest } from "../types";
import { encrypt, decrypt, generateTotpSecret, verifyTotp, hashBackupCode, verifyBackupCode } from "../utils/encryption";

const router: Router = Router();
router.use(authenticate as any);

// ── 2FA ──────────────────────────────────────────────────────
router.post("/2fa/setup", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const { method, phoneNumber } = req.body;
    if (!["sms", "totp", "webauthn"].includes(method)) {
      return res.status(400).json({ success: false, error: "method must be sms, totp, or webauthn" });
    }
    let secret: string | null = null;
    let provisioningUri: string | null = null;
    if (method === "totp") {
      const raw = generateTotpSecret();
      secret = encrypt(raw);
      const issuer = "Zyrix";
      const label = encodeURIComponent(`${issuer}:${userId}`);
      provisioningUri = `otpauth://totp/${label}?secret=${Buffer.from(raw, "hex").toString("base64").replace(/=+$/, "")}&issuer=${issuer}`;
    }
    // Generate 10 backup codes (returned ONCE — must be saved client-side)
    const backupCodes = Array.from({ length: 10 }).map(() =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );
    const hashedBackup = backupCodes.map((c) => hashBackupCode(c));
    const upserted = await prisma.twoFactorAuth.upsert({
      where: { userId },
      create: {
        userId,
        method,
        secret,
        phoneNumber: method === "sms" ? phoneNumber : null,
        backupCodes: hashedBackup,
        enabled: false,
      },
      update: {
        method,
        secret,
        phoneNumber: method === "sms" ? phoneNumber : null,
        backupCodes: hashedBackup,
        enabled: false,
      },
    });
    return res.json({
      success: true,
      data: { id: upserted.id, method, provisioningUri, backupCodes },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/2fa/verify", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const { code } = req.body;
    const tfa = await prisma.twoFactorAuth.findUnique({ where: { userId } });
    if (!tfa || !tfa.secret) return res.status(404).json({ success: false, error: "2FA not set up" });
    let valid = false;
    if (tfa.method === "totp") {
      const decrypted = decrypt(tfa.secret);
      valid = verifyTotp(String(code), decrypted);
    }
    // Backup code fallback
    if (!valid && Array.isArray(tfa.backupCodes)) {
      valid = (tfa.backupCodes as string[]).some((stored) => verifyBackupCode(String(code).toUpperCase(), stored));
    }
    if (!valid) return res.status(401).json({ success: false, error: "Invalid code" });
    await prisma.twoFactorAuth.update({
      where: { userId },
      data: { enabled: true, enabledAt: tfa.enabledAt || new Date(), lastUsedAt: new Date() },
    });
    return res.json({ success: true, data: { verified: true } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/2fa", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    await prisma.twoFactorAuth.deleteMany({ where: { userId } });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/2fa", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const tfa = await prisma.twoFactorAuth.findUnique({ where: { userId } });
    if (!tfa) return res.json({ success: true, data: { enabled: false } });
    return res.json({
      success: true,
      data: {
        enabled: tfa.enabled,
        method: tfa.method,
        enabledAt: tfa.enabledAt,
        lastUsedAt: tfa.lastUsedAt,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────────
router.get("/sessions", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const sessions = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: "desc" },
    });
    return res.json({ success: true, data: sessions });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/sessions/:id", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const updated = await prisma.userSession.updateMany({
      where: { id: req.params.id, userId },
      data: { revokedAt: new Date() },
    });
    return res.json({ success: true, data: { revoked: updated.count } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── Audit log ─────────────────────────────────────────────────
router.get("/audit-log", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const { page = "1", limit = "50", action, resourceType, from, to } = req.query;
    const where: any = { merchantId };
    if (action) where.action = String(action);
    if (resourceType) where.resourceType = String(resourceType);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) where.createdAt.lte = new Date(String(to));
    }
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);
    return res.json({ success: true, data: { items, total, page: Number(page), limit: Number(limit) } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/audit-log/export", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const merchantId = auth.merchant!.id;
    const items = await prisma.auditLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const header = "createdAt,userId,action,resourceType,resourceId,ipAddress\n";
    const rows = items
      .map(
        (i) =>
          `${i.createdAt.toISOString()},${i.userId},${i.action},${i.resourceType || ""},${i.resourceId || ""},${i.ipAddress || ""}`
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${Date.now()}.csv"`);
    res.send(header + rows);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── KVKK / GDPR data export ───────────────────────────────────
router.post("/data-export-request", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const merchantId = auth.merchant!.id;
    const { reason } = req.body;
    const request = await prisma.dataExportRequest.create({
      data: {
        userId,
        merchantId,
        reason: reason || "user_request",
        status: "pending",
      },
    });
    return res.json({ success: true, data: request });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/data-export-request", async (req, res: Response) => {
  try {
    const auth = req as AuthenticatedRequest;
    const userId = (auth.merchant as any).userId || auth.merchant!.id;
    const requests = await prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: "desc" },
    });
    return res.json({ success: true, data: requests });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
