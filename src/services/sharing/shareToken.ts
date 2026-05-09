// ================================================================
// shareToken.ts — JWT-signed token for the public PDF share endpoint.
// Sprint D-3 option (γ): no external storage, no signed URLs against
// S3/R2; instead each `InsightShare` row gets a JWT signed with the
// existing `env.jwtSecret`, and `GET /share/:token` regenerates the
// PDF on demand from the D-2 renderer.
//
// Token shape:
//   {
//     shareId:    string  // InsightShare.id
//     merchantId: string  // owning merchant — cross-checked at decode
//     iat:        number
//     exp:        number  // 7 days
//     iss:        'zyrix-finsuite-d3-share'
//   }
// ================================================================
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

const ISSUER          = "zyrix-finsuite-d3-share";
const DEFAULT_EXPIRY  = "7d";

export interface ShareTokenPayload {
  shareId:    string;
  merchantId: string;
  iat?:       number;
  exp?:       number;
  iss?:       string;
}

export function signShareToken(args: {
  shareId:    string;
  merchantId: string;
  expiresIn?: string;
}): string {
  return jwt.sign(
    { shareId: args.shareId, merchantId: args.merchantId },
    env.jwtSecret,
    { issuer: ISSUER, expiresIn: (args.expiresIn || DEFAULT_EXPIRY) as any }
  );
}

export function verifyShareToken(token: string): ShareTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret, { issuer: ISSUER }) as ShareTokenPayload;
  if (!decoded.shareId || !decoded.merchantId) {
    throw new Error("Share token payload missing required fields.");
  }
  return decoded;
}
