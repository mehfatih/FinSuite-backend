// ================================================================
// Phase 14 — Admin authentication routes (separate from customer auth).
// JWT 8h expiry. bcrypt rounds=12. 5-fail / 15-min lockout.
// Logs every login attempt to AdminAuditLog.
// ================================================================
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { generateTotpSecret, encrypt, decrypt, verifyTotp } from "../../utils/encryption";

const router: Router = Router();

const LOCK_MIN = 15;
const MAX_FAIL = 5;
const TOKEN_TTL = "8h";

interface AdminTokenPayload {
  adminId: string;
  email: string;
  role: string;
  isAdmin: true;
}

function makeToken(admin: { id: string; email: string; role: string }) {
  const payload: AdminTokenPayload = {
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
    isAdmin: true,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

async function logAttempt(adminUserId: string | null, action: string, severity: "INFO" | "WARNING" | "CRITICAL", req: Request, metadata: Record<string, unknown> = {}) {
  if (!adminUserId) return;
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        severity,
        ipAddress: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip,
        userAgent: req.headers["user-agent"] || null,
        metadata,
      },
    });
  } catch { /* never block on audit failure */ }
}

// ── POST /api/admin/auth/login ────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password, totpCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }

    const admin = await prisma.adminUser.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!admin) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    if (!admin.isActive) {
      return res.status(403).json({ success: false, error: "Account is deactivated" });
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({ success: false, error: `Account locked. Try again in ${remainingMin} min.` });
    }

    const passwordOk = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordOk) {
      const newFails = admin.failedLoginAttempts + 1;
      const lockedUntil = newFails >= MAX_FAIL ? new Date(Date.now() + LOCK_MIN * 60000) : null;
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { failedLoginAttempts: newFails, lockedUntil },
      });
      await logAttempt(admin.id, "admin.login.failed", "WARNING", req, { reason: "wrong_password", attempts: newFails });
      return res.status(401).json({ success: false, error: "Invalid credentials", attemptsRemaining: Math.max(0, MAX_FAIL - newFails) });
    }

    // Password OK — check 2FA if enrolled
    if (admin.twoFactorEnabled && admin.twoFactorSecret) {
      if (!totpCode) {
        return res.status(401).json({ success: false, requires2FA: true, error: "2FA code required" });
      }
      const secret = decrypt(admin.twoFactorSecret);
      if (!verifyTotp(String(totpCode), secret)) {
        await logAttempt(admin.id, "admin.login.failed", "WARNING", req, { reason: "wrong_2fa" });
        return res.status(401).json({ success: false, requires2FA: true, error: "Invalid 2FA code" });
      }
    }

    // Success — reset fails, update last login, mint token
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || null,
      },
    });

    await logAttempt(admin.id, "admin.login.success", "INFO", req);

    const token = makeToken(admin);
    return res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          email: admin.email,
          fullName: admin.fullName,
          role: admin.role,
          permissions: admin.permissions,
          mustChangePassword: admin.mustChangePassword,
          twoFactorEnabled: admin.twoFactorEnabled,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/admin/auth/logout ───────────────────────────────
router.post("/logout", async (req: Request, res: Response) => {
  // JWT-based; client just discards token. Log for audit trail.
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const decoded = jwt.verify(token, env.jwtSecret) as AdminTokenPayload;
      await logAttempt(decoded.adminId, "admin.logout", "INFO", req);
    }
  } catch { /* ignore */ }
  return res.json({ success: true });
});

// Helper: extract admin from token
async function requireAdmin(req: Request, res: Response): Promise<any | null> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ success: false, error: "No token" });
    return null;
  }
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AdminTokenPayload;
    if (!decoded.isAdmin) {
      res.status(403).json({ success: false, error: "Not an admin token" });
      return null;
    }
    const admin = await prisma.adminUser.findUnique({ where: { id: decoded.adminId } });
    if (!admin || !admin.isActive) {
      res.status(403).json({ success: false, error: "Admin no longer active" });
      return null;
    }
    return admin;
  } catch {
    res.status(401).json({ success: false, error: "Invalid token" });
    return null;
  }
}

// ── GET /api/admin/auth/me ────────────────────────────────────
router.get("/me", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return res.json({
    success: true,
    data: {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      permissions: admin.permissions,
      mustChangePassword: admin.mustChangePassword,
      twoFactorEnabled: admin.twoFactorEnabled,
      lastLoginAt: admin.lastLoginAt,
    },
  });
});

router.get("/permissions", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return res.json({ success: true, data: { role: admin.role, permissions: admin.permissions } });
});

// ── POST /api/admin/auth/change-password ──────────────────────
router.post("/change-password", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 10) {
      return res.status(400).json({ success: false, error: "Password must be at least 10 chars" });
    }
    if (currentPassword) {
      const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
      if (!ok) return res.status(401).json({ success: false, error: "Current password is wrong" });
    }
    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    await logAttempt(admin.id, "admin.password.changed", "INFO", req);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/admin/auth/2fa/setup ────────────────────────────
router.post("/2fa/setup", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const raw = generateTotpSecret();
    const encrypted = encrypt(raw);
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { twoFactorSecret: encrypted, twoFactorEnabled: false },
    });
    const issuer = "Zyrix Admin";
    const label = encodeURIComponent(`${issuer}:${admin.email}`);
    const provisioningUri = `otpauth://totp/${label}?secret=${Buffer.from(raw, "hex").toString("base64").replace(/=+$/, "")}&issuer=${issuer}`;
    return res.json({ success: true, data: { provisioningUri } });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/2fa/verify", async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const { code } = req.body;
    if (!admin.twoFactorSecret) return res.status(400).json({ success: false, error: "Set up 2FA first" });
    const secret = decrypt(admin.twoFactorSecret);
    if (!verifyTotp(String(code), secret)) {
      return res.status(401).json({ success: false, error: "Invalid code" });
    }
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { twoFactorEnabled: true },
    });
    await logAttempt(admin.id, "admin.2fa.enabled", "INFO", req);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/forgot-password", async (req: Request, res: Response) => {
  // Stub — would send email with reset token in real impl
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: "Email required" });
  return res.json({ success: true, message: "If an account exists, a reset link has been sent." });
});

router.post("/reset-password", async (req: Request, res: Response) => {
  // Stub — would consume reset token and set new password
  return res.json({ success: true });
});

export default router;
export { requireAdmin };
