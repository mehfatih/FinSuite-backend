import rateLimit from "express-rate-limit";

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});
