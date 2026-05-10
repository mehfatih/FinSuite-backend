// ================================================================
// Sprint D-10 — Health endpoint with dependency status.
//
// GET /health   returns 200 with per-dep status. Uptime monitors
//               (UptimeRobot, etc.) treat any non-200 as down. We
//               return 200 even when sub-deps are unhealthy so a
//               degraded-but-running service doesn't trigger pages
//               at 3am — the dep map carries the truth and the
//               admin observability dashboard reads it.
//
// GET /health/ready  returns 503 when DB is unreachable. Used by
//               Railway / load-balancer readiness probes that DO
//               want to remove the instance from the pool when the
//               primary dep fails.
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../config/database";
import { isSentryEnabled } from "../services/observability/sentry";
import { isSlackConfigured } from "../services/integrations/slack/config";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

type DepStatus = "ok" | "degraded" | "down" | "not_configured";

interface DepResult {
  status:    DepStatus;
  /** Optional one-line note for the admin dashboard. */
  note?:     string;
  latencyMs?: number;
}

const DB_PROBE_TIMEOUT_MS  = 1500;
const DB_DEGRADED_LATENCY  = 500;

async function probeDatabase(): Promise<DepResult> {
  const t0 = Date.now();
  try {
    const probe = prisma.$queryRaw`SELECT 1 AS ok`;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("db_timeout")), DB_PROBE_TIMEOUT_MS)
    );
    await Promise.race([probe, timeout]);
    const latencyMs = Date.now() - t0;
    return {
      status: latencyMs > DB_DEGRADED_LATENCY ? "degraded" : "ok",
      latencyMs
    };
  } catch (err: any) {
    return { status: "down", note: err?.message || String(err), latencyMs: Date.now() - t0 };
  }
}

function probeKey(envVar: string): DepResult {
  return process.env[envVar] ? { status: "ok" } : { status: "not_configured" };
}

export const healthController = {
  // GET /health — soft probe. Always 200; body says what's healthy.
  full: h(async (_req: Request, res: Response): Promise<void> => {
    const started = Date.now();
    const [db] = await Promise.all([probeDatabase()]);

    const deps: Record<string, DepResult> = {
      database: db,
      gemini:   probeKey("GEMINI_API_KEY"),
      resend:   probeKey("RESEND_API_KEY"),
      slack:    isSlackConfigured() ? { status: "ok" } : { status: "not_configured", note: "SLACK_* env vars deferred until launch prep complete" },
      sentry:   isSentryEnabled()  ? { status: "ok" } : { status: "not_configured", note: "SENTRY_DSN deferred" },
      vapid:    (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) ? { status: "ok" } : { status: "not_configured" }
    };

    res.status(200).json({
      success: true,
      data: {
        status:      "ok",
        service:     "zyrix-finsuite-backend",
        version:     process.env.npm_package_version || "3.0.0",
        environment: process.env.NODE_ENV || "development",
        timestamp:   new Date().toISOString(),
        uptimeSec:   Math.round(process.uptime()),
        elapsedMs:   Date.now() - started,
        deps
      }
    });
  }),

  // GET /health/ready — strict readiness probe. 503 when DB is down.
  ready: h(async (_req: Request, res: Response): Promise<void> => {
    const db = await probeDatabase();
    if (db.status === "down") {
      res.status(503).json({ success: false, error: "database_unreachable", note: db.note });
      return;
    }
    res.status(200).json({ success: true, data: { ready: true } });
  })
};
