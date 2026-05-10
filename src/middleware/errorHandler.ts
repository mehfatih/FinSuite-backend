// ================================================================
// Sprint D-10 — Error handler middleware.
//
// Logs the stack to stdout (Railway captures it), forwards the error
// to Sentry when configured (no-op when SENTRY_DSN unset), and returns
// a customer-facing JSON body that includes the request id so support
// can correlate when a merchant reports a 500.
// ================================================================
import { Request, Response, NextFunction } from "express";
import { captureException, setMerchantContext } from "../services/observability/sentry";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const requestId = req.requestId;
  console.error(`[error]${requestId ? ` rid=${requestId}` : ""} ${req.method} ${req.path} —`, err.stack);

  // Tag scope with merchantId if auth has run on this request.
  const merchantId = (req as any).merchant?.id || null;
  setMerchantContext(merchantId);

  captureException(err, {
    method:     req.method,
    path:       req.path,
    requestId,
    merchantId,
    userAgent:  req.headers["user-agent"]
  });

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    requestId
  });
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success:   false,
    error:     `Route ${req.method} ${req.path} not found`,
    requestId: req.requestId
  });
};
