import { Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AdminRequest } from "../types";

export const authenticateAdmin: RequestHandler = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const decoded = jwt.verify(token, env.jwtAdminSecret) as any;
    (req as AdminRequest).admin = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: "Invalid admin token" });
  }
};
