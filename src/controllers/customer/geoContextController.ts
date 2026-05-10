// ================================================================
// Sprint D-11 — Geo-context endpoint.
//
// GET /api/users/me/geo-context  (auth-required)
//   →  { ipCountry, registeredCountry, language, mismatch }
//
// Per discovery decision §10.D: front-end useCountry hook adds this
// as the FIRST step of its detection chain. Reads CF-IPCountry from
// the request headers (already populated by Cloudflare in front of
// Railway); falls back to x-vercel-ip-country.
//
// "mismatch" lets the frontend show the subtle once-per-session
// banner from B.12 ("you're connecting from {ipCountry} but your
// account is in {registeredCountry}").
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

function readIpCountry(req: Request): string | null {
  const cf = req.headers["cf-ipcountry"];
  if (typeof cf === "string" && cf.length > 0 && cf !== "XX") return cf.toUpperCase();
  const vercel = req.headers["x-vercel-ip-country"];
  if (typeof vercel === "string" && vercel.length > 0) return vercel.toUpperCase();
  return null;
}

export const geoContextController = {
  // GET /api/users/me/geo-context
  get: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const merchant = await prisma.merchant.findUnique({
      where:  { id: merchantId },
      select: { country: true, language: true }
    });
    const registeredCountry = (merchant?.country || "TR").toUpperCase();
    const language = merchant?.language || "TR";

    const ipCountry = readIpCountry(req);
    const mismatch = ipCountry !== null && ipCountry !== registeredCountry;

    res.json({
      success: true,
      data: {
        ipCountry,            // 'TR' | 'SA' | … | null when CF-IPCountry absent
        registeredCountry,    // from Merchant.country
        language,             // from Merchant.language
        mismatch              // true → frontend shows subtle banner once
      }
    });
  })
};
