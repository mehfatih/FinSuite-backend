// ================================================================
// Sprint D-10 — V2-dashboard rollout flag.
//
// Decision §10.E option E1 — env-var-based percentage gate. The
// merchant's id is hashed deterministically (md5 mod 100) and
// compared against V2_DASHBOARD_ROLLOUT_PCT. A merchant is either
// permanently in or permanently out for a given pct value; bumping
// the pct only ever lets MORE merchants in.
//
// Per Mehmet's deferred-env-vars rule: V2_DASHBOARD_ROLLOUT_PCT
// defaults to 100 when unset, so the 2 test merchants always see V2.
//
// GET /api/customer/rollout/v2-dashboard   auth-required.
//   → { enabled: boolean, pct: number, bucket: number }
// ================================================================
import { Request, Response, RequestHandler } from "express";
import crypto from "crypto";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

/** Deterministic 0-99 bucket from a merchant id. */
export function bucketFor(merchantId: string): number {
  const hash = crypto.createHash("md5").update(merchantId).digest();
  // First 4 bytes as unsigned int → mod 100 gives a uniform bucket.
  return hash.readUInt32BE(0) % 100;
}

function readPct(): number {
  const raw = process.env.V2_DASHBOARD_ROLLOUT_PCT;
  if (raw === undefined || raw === "") return 100;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, n));
}

export const rolloutController = {
  // GET /api/customer/rollout/v2-dashboard
  v2Dashboard: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const pct    = readPct();
    const bucket = bucketFor(merchantId);
    const enabled = bucket < pct;

    res.json({
      success: true,
      data: { enabled, pct, bucket }
    });
  })
};
