// ================================================================
// Phase 13 — AES-256-GCM encryption for sensitive data (2FA secrets)
// Key from process.env.ENCRYPTION_KEY (must be 32 bytes hex-encoded).
// ================================================================
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY env var is not set (need 32 bytes hex)");
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: iv (hex) | tag (hex) | ciphertext (hex)
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted payload format");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString("utf8");
}

// Hash backup codes — sha256 with per-code salt.
export function hashBackupCode(code: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(code, salt, 100000, 32, "sha256");
  return [salt.toString("hex"), hash.toString("hex")].join(":");
}

export function verifyBackupCode(code: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(":");
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const candidate = crypto.pbkdf2Sync(code, salt, 100000, 32, "sha256");
    return crypto.timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

// 6-digit TOTP — RFC 6238 reference impl (no external dep).
export function generateTotpSecret(): string {
  return crypto.randomBytes(20).toString("hex");
}

export function totpCode(secretHex: string, time: number = Date.now()): string {
  const counter = Math.floor(time / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const key = Buffer.from(secretHex, "hex");
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return binCode.toString().padStart(6, "0");
}

export function verifyTotp(code: string, secretHex: string): boolean {
  const now = Date.now();
  // accept ±1 window (30s either side) to handle clock drift
  return [-1, 0, 1].some((window) => {
    const t = now + window * 30 * 1000;
    return totpCode(secretHex, t) === code;
  });
}
