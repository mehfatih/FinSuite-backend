// ============================================================
// Zyrix FinSuite - IP Allowlist Service
// Sprint 3 - Network-level access control
//
// Per-merchant configurable allowlist or blocklist of IPs.
// Three modes: DISABLED, ALLOWLIST, BLOCKLIST.
// Supports exact IP match and CIDR range (e.g. 192.168.1.0/24).
// ============================================================

import { IpAllowlistMode } from "@prisma/client";
import { prisma } from "../config/database";

/**
 * Convert IPv4 string to integer for CIDR matching.
 */
function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0; // unsigned
}

/**
 * Check if a given IP is inside a CIDR block.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) {
    return ip.trim() === cidr.trim();
  }
  const [base, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;

  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export interface IpCheckResult {
  allowed: boolean;
  mode: IpAllowlistMode;
  matchedEntry?: string;
  reason?: string;
}

/**
 * Check if an IP is allowed for a merchant.
 * If mode is DISABLED, always returns allowed=true.
 */
export async function checkIp(merchantId: string, ip: string): Promise<IpCheckResult> {
  const config = await prisma.ipAllowlistConfig.findUnique({
    where: { merchantId },
  });

  // No config = mode disabled = allow everyone
  if (!config || config.mode === "DISABLED") {
    return { allowed: true, mode: "DISABLED" };
  }

  const entries = await prisma.ipAllowlistEntry.findMany({
    where: { merchantId, isActive: true },
  });

  let matched: string | null = null;
  for (const entry of entries) {
    if (ipInCidr(ip, entry.ipAddress)) {
      matched = entry.ipAddress;
      break;
    }
  }

  if (config.mode === "ALLOWLIST") {
    return {
      allowed: matched !== null,
      mode: "ALLOWLIST",
      matchedEntry: matched || undefined,
      reason: matched ? "Allowed by entry " + matched : "Not in allowlist",
    };
  }

  if (config.mode === "BLOCKLIST") {
    return {
      allowed: matched === null,
      mode: "BLOCKLIST",
      matchedEntry: matched || undefined,
      reason: matched ? "Blocked by entry " + matched : "Not in blocklist",
    };
  }

  return { allowed: true, mode: config.mode };
}

/**
 * Get config + entries for a merchant.
 */
export async function getAllowlistForMerchant(merchantId: string) {
  const [config, entries] = await Promise.all([
    prisma.ipAllowlistConfig.findUnique({ where: { merchantId } }),
    prisma.ipAllowlistEntry.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    config: config || { merchantId, mode: "DISABLED" as IpAllowlistMode, enforceFor: [] },
    entries,
  };
}

/**
 * Update or create config.
 */
export async function setMode(
  merchantId: string,
  mode: IpAllowlistMode,
  enforceFor: string[] = []
) {
  return prisma.ipAllowlistConfig.upsert({
    where: { merchantId },
    create: {
      merchantId,
      mode,
      enforceFor: enforceFor as any,
    },
    update: {
      mode,
      enforceFor: enforceFor as any,
    },
  });
}

/**
 * Add an IP/CIDR entry.
 */
export async function addEntry(
  merchantId: string,
  ipAddress: string,
  description?: string,
  createdBy?: string
) {
  return prisma.ipAllowlistEntry.create({
    data: {
      merchantId,
      ipAddress: ipAddress.trim(),
      description: description || null,
      createdBy: createdBy || null,
    },
  });
}

/**
 * Remove an entry.
 */
export async function removeEntry(merchantId: string, entryId: string) {
  return prisma.ipAllowlistEntry.deleteMany({
    where: { id: entryId, merchantId },
  });
}

/**
 * Toggle an entry's active state.
 */
export async function toggleEntry(merchantId: string, entryId: string, isActive: boolean) {
  return prisma.ipAllowlistEntry.updateMany({
    where: { id: entryId, merchantId },
    data: { isActive },
  });
}
