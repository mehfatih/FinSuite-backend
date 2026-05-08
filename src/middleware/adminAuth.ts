// ================================================================
// Admin auth middleware.
//
// Two admin login flows exist in this codebase that sign with
// different secrets:
//   - /api/admin/auth/login (Phase 14, current frontend) signs with
//     env.jwtSecret and emits { adminId, email, role, isAdmin: true }
//   - /api/admin/login      (legacy)        signs with
//     env.jwtAdminSecret and emits { id, email, role }
//
// Verify against jwtSecret FIRST (require isAdmin to be safe so a
// stolen customer token can't unlock admin endpoints), and fall back
// to jwtAdminSecret for legacy tokens. Either way we normalize the
// payload onto req.admin = { id, email, role } so downstream code
// that already reads req.admin.id keeps working.
// ================================================================
import { Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AdminRequest } from "../types";

export const authenticateAdmin: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ success: false, error: "No token provided" });
    return;
  }

  let decoded: any = null;

  // Try the Phase 14 admin token (signed with jwtSecret).
  try {
    const candidate = jwt.verify(token, env.jwtSecret) as any;
    if (candidate?.isAdmin) decoded = candidate;
  } catch { /* fall through */ }

  // Fall back to the legacy admin token (signed with jwtAdminSecret).
  if (!decoded) {
    try {
      decoded = jwt.verify(token, env.jwtAdminSecret) as any;
    } catch { /* both verifies failed */ }
  }

  if (!decoded) {
    res.status(401).json({ success: false, error: "Invalid admin token" });
    return;
  }

  (req as AdminRequest).admin = {
    id: decoded.adminId || decoded.id,
    email: decoded.email,
    role: decoded.role,
  };
  next();
};
