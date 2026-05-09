// ================================================================
// Phase 16 — Real KPI values controller.
// GET /api/customer/dashboard/kpi-values?ids=mrr,cash_runway,...
//
// Computes the requested KPIs in parallel via the registry in
// kpiComputations.ts. Each KPI is wrapped in its own try/catch so
// a single failure returns EMPTY for that id, never the whole call.
// ================================================================
import { Request, Response, NextFunction, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";
import { KPI_COMPUTATIONS, KpiResult } from "../../services/customer/kpiComputations";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_IDS = new Set(Object.keys(KPI_COMPUTATIONS));
const EMPTY: KpiResult = { value: null, trend: 0, sparkline: new Array(14).fill(0) };
const MAX_IDS_PER_REQUEST = 12;

export const kpiValuesController = {
  getKpiValues: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) {
      res.status(401).json({ success: false, error: "Auth required." });
      return;
    }

    const idsParam = String(req.query.ids || "").trim();
    if (!idsParam) {
      res.status(400).json({ success: false, error: "ids query parameter is required." });
      return;
    }

    const requestedIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);

    if (requestedIds.length > MAX_IDS_PER_REQUEST) {
      res.status(400).json({
        success: false,
        error: `Maximum ${MAX_IDS_PER_REQUEST} KPI ids per request.`,
      });
      return;
    }

    const unknown = requestedIds.filter((id) => !ALLOWED_IDS.has(id));
    if (unknown.length > 0) {
      res.status(400).json({
        success: false,
        error: `Unknown KPI ids: ${unknown.join(", ")}`,
      });
      return;
    }

    const results = await Promise.all(
      requestedIds.map(async (id) => {
        try {
          const r = await KPI_COMPUTATIONS[id](merchantId, prisma);
          return [id, r] as const;
        } catch {
          return [id, EMPTY] as const;
        }
      })
    );

    const data: Record<string, KpiResult> = {};
    for (const [id, r] of results) data[id] = r;

    res.json({ success: true, data });
  }),
};
