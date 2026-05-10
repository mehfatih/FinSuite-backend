// ================================================================
// Sprint D-10 — Request ID middleware.
// Stamps every request with a short unique id for log correlation
// + error-response payloads. Honors an existing `x-request-id`
// header so reverse proxies (Cloudflare / Railway) can supply one.
// ================================================================
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id = (typeof incoming === "string" && incoming.length > 0 && incoming.length < 128)
    ? incoming
    : crypto.randomBytes(8).toString("hex");
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
