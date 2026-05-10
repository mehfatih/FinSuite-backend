// ================================================================
// Sprint D-8 — Chat action endpoints (decision §7.G option G1).
//
//   POST /api/customer/chat/actions/:type   (Bearer auth)
//
// Allowlist of mutating actions the chat AI may PROPOSE via the
// create_reminder etc. tools. The model never executes mutations
// directly — the engine emits an `action` event on the assistant
// message, the UI renders an action button, and only on user
// click does this endpoint actually mutate state under the
// merchant's JWT.
//
// V1 actions:
//   create_reminder       — creates a Task row (TODO status)
//   dismiss_insight       — flips Insight.status to DISMISSED
//   mark_invoice_paid     — flips Invoice.status to PAID + paidDate
//
// Every handler:
//   - Reads merchantId from the trusted JWT context
//   - Validates the resource (if any) belongs to the merchant
//   - Writes a row to MerchantAuditLog with source='chat'
// ================================================================
import { Request, Response, RequestHandler } from "express";
import { prisma } from "../../config/database";
import { AuthenticatedRequest } from "../../types";

const h = (fn: Function): RequestHandler => fn as RequestHandler;

const ALLOWED_ACTIONS = new Set(["create_reminder", "dismiss_insight", "mark_invoice_paid"]);

// ─── Audit log helper ────────────────────────────────────────

// MerchantAuditLog.action is a typed enum (AuditActionType). We map
// each chat action onto the closest semantic enum value and stamp
// the original chat-action name in metadata.chatAction so the admin
// dashboard can group by it.
const ENUM_FOR: Record<string, "CREATE" | "UPDATE" | "DELETE"> = {
  create_reminder:    "CREATE",
  dismiss_insight:    "UPDATE",
  mark_invoice_paid:  "UPDATE"
};

async function audit(args: {
  merchantId: string;
  action:     string;       // chat-action name (create_reminder etc.)
  resource:   string;       // 'task' | 'insight' | 'invoice'
  resourceId?: string;
  metadata:   Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.merchantAuditLog.create({
      data: {
        merchantId: args.merchantId,
        action:     ENUM_FOR[args.action] || "UPDATE",
        resource:   args.resource,
        resourceId: args.resourceId,
        metadata:   { source: "chat", chatAction: args.action, ...args.metadata } as any
      }
    });
  } catch (err: any) {
    console.error("[chat/actions/audit] failed:", err?.message || err);
  }
}

// ─── Per-action handlers ─────────────────────────────────────

async function handleCreateReminder(merchantId: string, payload: any) {
  const title   = String(payload?.title   || "").trim();
  const dueRaw  = String(payload?.dueDate || "").trim();
  const notes   = String(payload?.notes   || "").trim();

  if (!title) return { ok: false, error: "title_required" };
  if (title.length > 120)  return { ok: false, error: "title_too_long" };
  if (notes.length > 1000) return { ok: false, error: "notes_too_long" };

  let dueDate: Date | null = null;
  if (dueRaw) {
    const d = new Date(dueRaw);
    if (!Number.isFinite(d.getTime())) return { ok: false, error: "invalid_due_date" };
    dueDate = d;
  }

  const created = await prisma.task.create({
    data: {
      merchantId,
      title,
      description: notes || undefined,
      dueDate:     dueDate || undefined,
      // priority defaults MEDIUM, status defaults TODO per schema
    },
    select: { id: true, title: true, dueDate: true, status: true }
  });

  await audit({
    merchantId,
    action:     "create_reminder",
    resource:   "task",
    resourceId: created.id,
    metadata:   { title, dueDate: dueRaw }
  });

  return { ok: true, task: created };
}

async function handleDismissInsight(merchantId: string, payload: any) {
  const insightId = String(payload?.insightId || "").trim();
  if (!insightId) return { ok: false, error: "insight_id_required" };

  // Ownership boundary.
  const owned = await prisma.insight.findFirst({
    where:  { id: insightId, merchantId },
    select: { id: true, title: true }
  });
  if (!owned) return { ok: false, error: "insight_not_found" };

  await prisma.insight.update({
    where: { id: insightId },
    data:  { status: "DISMISSED", dismissedAt: new Date() }
  });

  await audit({
    merchantId,
    action:     "dismiss_insight",
    resource:   "insight",
    resourceId: insightId,
    metadata:   { title: owned.title }
  });

  return { ok: true, insightId };
}

async function handleMarkInvoicePaid(merchantId: string, payload: any) {
  const invoiceId = String(payload?.invoiceId || "").trim();
  if (!invoiceId) return { ok: false, error: "invoice_id_required" };

  // Ownership boundary.
  const owned = await prisma.invoice.findFirst({
    where:  { id: invoiceId, merchantId },
    select: { id: true, invoiceNumber: true, status: true }
  });
  if (!owned) return { ok: false, error: "invoice_not_found" };
  if (owned.status === "PAID") {
    return { ok: false, error: "invoice_already_paid" };
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: "PAID", paidDate: new Date() }
  });

  await audit({
    merchantId,
    action:     "mark_invoice_paid",
    resource:   "invoice",
    resourceId: invoiceId,
    metadata:   { invoiceNumber: owned.invoiceNumber }
  });

  return { ok: true, invoiceId };
}

const HANDLERS: Record<string, (m: string, p: any) => Promise<any>> = {
  create_reminder:    handleCreateReminder,
  dismiss_insight:    handleDismissInsight,
  mark_invoice_paid:  handleMarkInvoicePaid
};

// ─── Controller ─────────────────────────────────────────────

export const chatActionsController = {

  execute: h(async (req: Request, res: Response): Promise<void> => {
    const merchantId = (req as AuthenticatedRequest).merchant?.id;
    if (!merchantId) { res.status(401).json({ success: false, error: "Auth required." }); return; }

    const type = String(req.params.type || "");
    if (!ALLOWED_ACTIONS.has(type)) {
      res.status(400).json({ success: false, error: "action_not_allowed", allowed: Array.from(ALLOWED_ACTIONS) });
      return;
    }

    const handler = HANDLERS[type];
    if (!handler) {
      res.status(500).json({ success: false, error: "handler_missing" });
      return;
    }

    const payload = req.body?.payload || req.body || {};
    try {
      const result = await handler(merchantId, payload);
      if (!result?.ok) {
        res.status(400).json({ success: false, error: result?.error || "action_failed" });
        return;
      }
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error(`[chat/actions/${type}] threw:`, err?.message || err);
      res.status(500).json({ success: false, error: "action_threw" });
    }
  })
};
