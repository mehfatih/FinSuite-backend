// ================================================================
// Sprint D-9 — Slack interactive-action router.
//
// Decision §10.E option E1 — allowlisted action_id prefixes:
//   view:<insightId>      no DB write; just opens FinSuite (button has
//                         a `url:` so click navigates client-side; the
//                         interaction webhook still fires for analytics)
//   resolve:<insightId>   updates Insight.status = RESOLVED
//   dismiss:<insightId>   updates Insight.status = DISMISSED
//   share:<insightId>     V2 — opens channel-picker modal; in V1 we ack
//                         with an "available soon" ephemeral.
//   view:kpi:<path>       slash-command CTA echo; analytics-only
//
// Returns either a JSON reply Slack will use to update the original
// message, or { ack: true } meaning the controller should reply 200 OK
// with empty body and let the action complete silently.
//
// Every action is audit-logged via MerchantAuditLog.
// ================================================================
import type { PrismaClient } from "@prisma/client";
import type { Locale, SlackBlock } from "./blockRenderer";

export interface InteractionPayload {
  type:    string;                  // "block_actions" | "view_submission" | …
  team?:   { id: string };
  user?:   { id: string; name?: string };
  actions?: Array<{
    action_id: string;
    value?:    string;
    type?:     string;
  }>;
  response_url?: string;
  trigger_id?:   string;
}

export interface RouteInteractionArgs {
  payload:    InteractionPayload;
  merchantId: string;              // resolved from team_id → SlackInstallation
  locale:     Locale;
  prisma:     PrismaClient;
}

export type InteractionReply =
  | { kind: "json"; body: { replace_original?: boolean; text?: string; blocks?: SlackBlock[]; response_type?: "ephemeral" | "in_channel" } }
  | { kind: "ack" };

const STRINGS: Record<Locale, {
  resolved:  string;
  dismissed: string;
  notFound:  string;
  shareSoon: string;
  unknown:   string;
}> = {
  tr: {
    resolved:  "✅ Bu öneri çözüldü olarak işaretlendi.",
    dismissed: "👋 Bu öneri yoksayıldı.",
    notFound:  "Öneri bulunamadı veya size ait değil.",
    shareSoon: "Başka kanala gönderme yakında geliyor.",
    unknown:   "Bilinmeyen aksiyon."
  },
  en: {
    resolved:  "✅ Marked as resolved.",
    dismissed: "👋 Dismissed.",
    notFound:  "Insight not found or not yours.",
    shareSoon: "Share-to-another-channel coming soon.",
    unknown:   "Unknown action."
  },
  ar: {
    resolved:  "✅ تم وضع كمحلول.",
    dismissed: "👋 تم التجاهل.",
    notFound:  "لم يتم العثور على البصيرة أو ليست لك.",
    shareSoon: "مشاركة إلى قناة أخرى قريبًا.",
    unknown:   "إجراء غير معروف."
  }
};

const ALLOWED_PREFIXES = ["view", "resolve", "dismiss", "share"] as const;
type ActionKind = typeof ALLOWED_PREFIXES[number];

interface ParsedAction {
  kind: ActionKind | null;
  arg:  string;            // everything after the first colon
  full: string;            // raw action_id
}

function parseActionId(actionId: string): ParsedAction {
  const idx = actionId.indexOf(":");
  if (idx < 0) return { kind: null, arg: "", full: actionId };
  const head = actionId.slice(0, idx);
  const rest = actionId.slice(idx + 1);
  if ((ALLOWED_PREFIXES as readonly string[]).includes(head)) {
    return { kind: head as ActionKind, arg: rest, full: actionId };
  }
  return { kind: null, arg: rest, full: actionId };
}

async function auditLog(args: {
  prisma:     PrismaClient;
  merchantId: string;
  action:     "UPDATE" | "READ";
  resourceId: string;
  metadata:   Record<string, unknown>;
}): Promise<void> {
  try {
    await args.prisma.merchantAuditLog.create({
      data: {
        merchantId: args.merchantId,
        action:     args.action,
        resource:   "slack_interaction",
        resourceId: args.resourceId,
        metadata:   args.metadata as any,
        success:    true
      }
    });
  } catch (err: any) {
    // Audit failures are best-effort — never block the user response.
    console.error("[slack/interaction] audit log failed:", err?.message || err);
  }
}

// ─── Handlers ────────────────────────────────────────────────

async function handleResolve(args: RouteInteractionArgs, insightId: string): Promise<InteractionReply> {
  const s = STRINGS[args.locale];
  // merchantId scoping — never trust the action_id alone.
  const insight = await args.prisma.insight.findFirst({
    where: { id: insightId, merchantId: args.merchantId }
  });
  if (!insight) {
    return { kind: "json", body: { response_type: "ephemeral", replace_original: false, text: s.notFound } };
  }

  if (insight.status !== "RESOLVED") {
    await args.prisma.insight.update({
      where: { id: insightId },
      data:  { status: "RESOLVED", resolvedAt: new Date() }
    });
  }

  await auditLog({
    prisma: args.prisma, merchantId: args.merchantId, action: "UPDATE",
    resourceId: insightId, metadata: { source: "slack", action: "resolve" }
  });

  return {
    kind: "json",
    body: {
      replace_original: true,
      text: s.resolved,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: s.resolved } }]
    }
  };
}

async function handleDismiss(args: RouteInteractionArgs, insightId: string): Promise<InteractionReply> {
  const s = STRINGS[args.locale];
  const insight = await args.prisma.insight.findFirst({
    where: { id: insightId, merchantId: args.merchantId }
  });
  if (!insight) {
    return { kind: "json", body: { response_type: "ephemeral", replace_original: false, text: s.notFound } };
  }

  if (insight.status !== "DISMISSED") {
    await args.prisma.insight.update({
      where: { id: insightId },
      data:  { status: "DISMISSED", dismissedAt: new Date() }
    });
  }

  await auditLog({
    prisma: args.prisma, merchantId: args.merchantId, action: "UPDATE",
    resourceId: insightId, metadata: { source: "slack", action: "dismiss" }
  });

  return {
    kind: "json",
    body: {
      replace_original: true,
      text: s.dismissed,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: s.dismissed } }]
    }
  };
}

async function handleView(args: RouteInteractionArgs, insightId: string): Promise<InteractionReply> {
  // The button has `url:` so the user is already navigating to FinSuite.
  // We just record the click for analytics.
  await auditLog({
    prisma: args.prisma, merchantId: args.merchantId, action: "READ",
    resourceId: insightId, metadata: { source: "slack", action: "view" }
  });
  return { kind: "ack" };
}

function handleShare(args: RouteInteractionArgs): InteractionReply {
  const s = STRINGS[args.locale];
  return {
    kind: "json",
    body: { response_type: "ephemeral", replace_original: false, text: s.shareSoon }
  };
}

// ─── Public entry point ──────────────────────────────────────

export async function routeInteraction(args: RouteInteractionArgs): Promise<InteractionReply> {
  const action = args.payload.actions?.[0];
  if (!action) return { kind: "ack" };

  const parsed = parseActionId(action.action_id);
  if (!parsed.kind) {
    const s = STRINGS[args.locale];
    return { kind: "json", body: { response_type: "ephemeral", text: s.unknown } };
  }

  // For `view:kpi:<path>` and other view subforms, the arg has another
  // colon. We only audit-log; no DB lookup makes sense here.
  if (parsed.kind === "view") {
    if (parsed.arg.startsWith("kpi:")) {
      await auditLog({
        prisma: args.prisma, merchantId: args.merchantId, action: "READ",
        resourceId: parsed.arg.slice("kpi:".length), metadata: { source: "slack", action: "view_kpi" }
      });
      return { kind: "ack" };
    }
    return await handleView(args, parsed.arg);
  }

  if (parsed.kind === "resolve") return await handleResolve(args, parsed.arg);
  if (parsed.kind === "dismiss") return await handleDismiss(args, parsed.arg);
  if (parsed.kind === "share")   return handleShare(args);

  return { kind: "ack" };
}
