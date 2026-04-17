import { Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthenticatedRequest } from "../types";

export const authenticate: RequestHandler = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const decoded = jwt.verify(token, env.jwtSecret) as any;
    (req as AuthenticatedRequest).merchant = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
};
