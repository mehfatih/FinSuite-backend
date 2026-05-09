// ================================================================
// Phase 15 — Customer Dashboard preferences controller.
// GET    /api/customer/dashboard/preferences
// PATCH  /api/customer/dashboard/preferences
// GET    /api/customer/dashboard/preferences/kpis
// Authenticates via the standard `authenticate` middleware which
// attaches the customer JWT payload to req.merchant ({ id, email, ... }).
// ================================================================
import { Request, Response, NextFunction, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_KPIS = [
  "mrr", "cash_runway", "cash_balance", "customer_health_pct", "tax_burden",
  "overdue_receivables", "pending_invoices", "payable_30d", "gross_margin", "top_customer_revenue",
  "mrr_growth_pct", "new_customers_30d", "churn_rate", "nrr", "arpu",
  "ai_actions_taken_today", "predictions_accuracy_30d", "automation_savings_hours", "crisis_risk_score", "hidden_cash_found_30d",
  "inventory_turnover", "service_utilization", "kdv_load", "vat_load", "zatca_compliance",
];

const FOCUS_AREAS = ["all", "cash", "sales", "tax", "customers", "operations"];
const LANGUAGES   = ["tr", "en", "ar"];

export const customerDashboardPrefsController = {
  // ── GET /preferences ─────────────────────────────────────────
  getPreferences: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      let prefs = await prisma.customerDashboardPreference.findUnique({
        where: { customerUserId: userId },
      });

      // Auto-create defaults on first read so the UI always has a row to work with.
      if (!prefs) {
        prefs = await prisma.customerDashboardPreference.create({
          data: { customerUserId: userId },
        });
      }

      res.status(200).json({ success: true, data: { preferences: prefs } });
    } catch (err: any) {
      console.error("[customer/dashboard/getPreferences] error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to load preferences" });
    }
  }),

  // ── PATCH /preferences ───────────────────────────────────────
  updatePreferences: h(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthenticatedRequest).merchant?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Auth required." });
        return;
      }

      const { kpiSlots, aiCoPilotFocus, sidebarCollapsed, language, role } = (req.body || {}) as {
        kpiSlots?: string[];
        aiCoPilotFocus?: string;
        sidebarCollapsed?: Record<string, boolean>;
        language?: string;
        role?: string;
      };

      if (kpiSlots !== undefined) {
        if (!Array.isArray(kpiSlots) || kpiSlots.length !== 4) {
          res.status(400).json({ success: false, error: "kpiSlots must be an array of exactly 4 KPI ids." });
          return;
        }
        const invalid = kpiSlots.filter((k) => !ALLOWED_KPIS.includes(k));
        if (invalid.length) {
          res.status(400).json({ success: false, error: `Unknown KPI ids: ${invalid.join(", ")}` });
          return;
        }
      }

      if (aiCoPilotFocus !== undefined && !FOCUS_AREAS.includes(aiCoPilotFocus)) {
        res.status(400).json({ success: false, error: `aiCoPilotFocus must be one of ${FOCUS_AREAS.join(", ")}.` });
        return;
      }

      if (language !== undefined && !LANGUAGES.includes(language)) {
        res.status(400).json({ success: false, error: "language must be tr, en, or ar." });
        return;
      }

      const updated = await prisma.customerDashboardPreference.upsert({
        where:  { customerUserId: userId },
        update: {
          ...(kpiSlots !== undefined         && { kpiSlots }),
          ...(aiCoPilotFocus !== undefined   && { aiCoPilotFocus }),
          ...(sidebarCollapsed !== undefined && { sidebarCollapsed }),
          ...(language !== undefined         && { language }),
          ...(role !== undefined             && { role }),
        },
        create: {
          customerUserId: userId,
          ...(kpiSlots         !== undefined && { kpiSlots }),
          ...(aiCoPilotFocus   !== undefined && { aiCoPilotFocus }),
          ...(sidebarCollapsed !== undefined && { sidebarCollapsed }),
          ...(language         !== undefined && { language }),
          ...(role             !== undefined && { role }),
        },
      });

      res.status(200).json({ success: true, data: { preferences: updated } });
    } catch (err: any) {
      console.error("[customer/dashboard/updatePreferences] error:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to update preferences" });
    }
  }),

  // ── GET /preferences/kpis ────────────────────────────────────
  listAvailableKpis: h(async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
    res.status(200).json({
      success: true,
      data: {
        kpis: ALLOWED_KPIS.map((id) => ({
          id,
          labelKey: `kpi.${id}.label`,
          descKey:  `kpi.${id}.desc`,
        })),
        focusAreas: FOCUS_AREAS,
      },
    });
  }),
};
