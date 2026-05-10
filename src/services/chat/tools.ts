// ================================================================
// Sprint D-8 — Gemini function declarations for the chat engine.
//
// These are the tool METADATA Gemini sees (names, descriptions,
// parameter shapes). The actual server-side execution lives in
// toolImpls.ts and ALWAYS runs scoped to merchantId from the JWT —
// never trusts arguments coming from the model or the client.
//
// Decision §7.C option C1: V1 ships thin wrappers around the
// existing KPI_COMPUTATIONS registry + a few merchant-data
// accessors. The `period` parameter is documented-but-ignored in
// V1; V2 promotes to true period-aware variants.
//
// Per spec hard rule, mutating tools (create_reminder etc.) are
// allowlisted server-side and audit-logged via MerchantAuditLog.
// ================================================================
import { SchemaType, FunctionDeclaration } from "@google/generative-ai";

// ─── Read-only tools (V1 — 8 functions) ─────────────────────

export const READ_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_kpi_value",
    description:
      "Get the current value of a named KPI (MRR, cash balance, gross margin, customer health, tax burden, etc.). Returns the value, a sparkline, and a trend percentage.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        kpiId: {
          type: SchemaType.STRING,
          description:
            "One of: mrr, mrr_growth_pct, top_customer_revenue, arpu, gross_margin, new_customers_30d, cash_balance, cash_runway, overdue_receivables, pending_invoices, customer_health_pct, tax_burden"
        },
        period: {
          type: SchemaType.STRING,
          description:
            "(V2) Period hint like 'this_month' / 'last_month' / 'last_7_days'. V1 ignores this; KPIs use their canonical window."
        }
      },
      required: ["kpiId"]
    }
  },
  {
    name: "get_top_customers",
    description: "Get the top N customers by revenue for the current month.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Number of customers to return (1-20). Default 5."
        }
      }
    }
  },
  {
    name: "get_invoices",
    description:
      "Query invoices by status, customer name, and/or date range. Returns up to 20 most recent matches.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        status: {
          type: SchemaType.STRING,
          description: "Optional: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED'"
        },
        customerName: {
          type: SchemaType.STRING,
          description: "Optional: case-insensitive customer name substring."
        },
        dateFrom: {
          type: SchemaType.STRING,
          description: "Optional ISO date (YYYY-MM-DD). Filters by createdAt >= this date."
        },
        dateTo: {
          type: SchemaType.STRING,
          description: "Optional ISO date (YYYY-MM-DD). Filters by createdAt < this date."
        }
      }
    }
  },
  {
    name: "get_expenses",
    description:
      "Query expenses by category and/or date range. Returns up to 20 most recent matches.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        category: {
          type: SchemaType.STRING,
          description: "Optional category filter (case-insensitive substring)."
        },
        dateFrom: {
          type: SchemaType.STRING,
          description: "Optional ISO date (YYYY-MM-DD)."
        },
        dateTo: {
          type: SchemaType.STRING,
          description: "Optional ISO date (YYYY-MM-DD)."
        }
      }
    }
  },
  {
    name: "get_tax_obligations",
    description: "List upcoming unpaid tax obligations within N days.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysAhead: {
          type: SchemaType.NUMBER,
          description: "How many days from today to include. Default 30, max 365."
        }
      }
    }
  },
  {
    name: "forecast_cash",
    description:
      "Project the merchant's cash balance N days into the future using current cash + recent burn rate. Returns the projected balance and the daily burn estimate.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysAhead: {
          type: SchemaType.NUMBER,
          description: "How many days to project (1-180). Default 30."
        }
      },
      required: ["daysAhead"]
    }
  },
  {
    name: "get_recent_insights",
    description: "Return the merchant's most recent active AI insights.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Max insights to return (1-10). Default 5."
        }
      }
    }
  },
  {
    name: "compare_periods",
    description:
      "(V2 stub) Compare a metric between two periods. V1 returns a not-implemented sentinel — the model should fall back to two get_kpi_value calls.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        metric:  { type: SchemaType.STRING, description: "KPI id (e.g. mrr)" },
        period1: { type: SchemaType.STRING },
        period2: { type: SchemaType.STRING }
      },
      required: ["metric", "period1", "period2"]
    }
  }
];

// ─── Mutating action tools (V1 — 1 function, allowlisted) ────

export const ACTION_TOOLS: FunctionDeclaration[] = [
  {
    name: "create_reminder",
    description:
      "Create a reminder/task for the merchant. The user MUST confirm via an action button on the resulting assistant message; the tool itself only PROPOSES the reminder, it does not write to the DB. The frontend renders the action; user click triggers POST /api/customer/chat/actions/create_reminder.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title:   { type: SchemaType.STRING },
        dueDate: { type: SchemaType.STRING, description: "ISO date YYYY-MM-DD" },
        notes:   { type: SchemaType.STRING }
      },
      required: ["title", "dueDate"]
    }
  }
];

/** All tool declarations passed to Gemini in the model config. */
export const ALL_TOOLS: FunctionDeclaration[] = [
  ...READ_TOOLS,
  ...ACTION_TOOLS
];

/** Names of tools whose execution mutates merchant data. The
 *  engine treats these as PROPOSALS only — output becomes an
 *  `actions[]` entry on the assistant message; the user must
 *  click an action button to actually trigger the side effect
 *  via POST /api/customer/chat/actions/:type. */
export const MUTATING_TOOLS = new Set(ACTION_TOOLS.map((t) => t.name));

/** Names of tools the engine actually executes server-side
 *  during a turn (read-only data fetches). */
export const READ_TOOL_NAMES = new Set(READ_TOOLS.map((t) => t.name));
