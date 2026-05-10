// ================================================================
// Sprint D-8 — Chat streaming engine.
//
// streamChat(args) returns an AsyncGenerator<ChatChunk> that the
// SSE controller consumes turn-by-turn. The engine:
//
//   1. Loads prior messages from the conversation and trims to fit
//      the 8K soft cap (memory.ts).
//   2. Builds Gemini's contents[] (system instruction inline + the
//      trimmed history + the new user message which has already
//      been persisted by the caller).
//   3. Calls model.generateContentStream({ contents, tools }).
//   4. Streams text chunks back as `token` events. When Gemini
//      emits function calls, the engine executes them via
//      dispatchTool() (each tool merchantId-scoped from the
//      trusted JWT context) and yields tool_call + tool_result
//      events.
//   5. Loops: appends function-call + function-response messages
//      to contents and re-calls generateContentStream until Gemini
//      emits a terminal text response (no further function calls).
//   6. Derives citations + charts + actions from accumulated tool
//      results.
//   7. Persists the final assistant ChatMessage row with full
//      content + toolCalls + toolResults + citations + charts +
//      actions + tokensUsed + inputTokens + outputTokens + latencyMs.
//   8. Yields a `done` event with the persisted messageId.
//
// All errors are wrapped in `error` events; the engine never
// throws from the generator (callers are SSE handlers that need
// graceful close).
// ================================================================
import { GoogleGenerativeAI, Content, FunctionCall } from "@google/generative-ai";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { ALL_TOOLS, MUTATING_TOOLS } from "./tools";
import { dispatchTool, ToolDispatchResult } from "./toolImpls";
import { trimMemoryToCap, MessageForMemory, sumTokens, estimateTokens } from "./memory";
import { maybeGenerateTitle } from "./titleGen";

const MAX_TOOL_LOOPS = 5;             // safety: cap function-call re-entrancy per turn
const STREAM_TIMEOUT_MS = 45_000;     // hard cap per turn

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

// ─── Public types ───────────────────────────────────────────

export type ChatChunk =
  | { event: "token";       data: { text: string } }
  | { event: "tool_call";   data: { name: string; args: any } }
  | { event: "tool_result"; data: { name: string; result: any } }
  | { event: "chart";       data: { type: string; data: any } }
  | { event: "action";      data: { label: string; type: string; payload: any } }
  | { event: "citation";    data: { type: string; id: string; label: string } }
  | { event: "error";       data: { message: string } }
  | { event: "done";        data: { messageId: string; conversationId: string; tokensUsed: number; latencyMs: number } };

export interface StreamChatArgs {
  conversationId:           string;
  placeholderAssistantId:   string;     // pre-created ChatMessage row to fill in
  merchantId:               string;
  locale:                   "tr" | "en" | "ar";
}

// ─── System prompt builder ──────────────────────────────────

const SYS = {
  tr: `Sen Zyrix FinSuite'in AI Co-Pilot'usun — Türkiye'deki bir KOBİ'nin kişisel CFO'su gibi davranıyorsun. Yanıtların somut sayılara dayalı olmalı, genel tavsiyelerden kaçın. Kullanıcının verisini sorgulamak için tools kullan. Sayıları yorumla, sadece listeleme. Aksiyon önerirken create_reminder tool'unu kullan — sistem buton olarak gösterecek, kullanıcı onaylayınca uygulanır. Yanıt formatı markdown'dur (kalın **bold**, italik *italic*, kod \`inline\`, kod blokları, linkler, satır sonu). Yanıt dili: TÜRKÇE.`,
  en: `You are Zyrix FinSuite's AI Co-Pilot — act as the personal CFO for a Turkey/MENA SMB. Ground every answer in concrete numbers; avoid generic advice. Use tools to query the user's data. Interpret numbers; don't just list. When proposing actions, use create_reminder — the system renders an action button and only applies on user click. Response format is markdown (**bold**, *italic*, \`inline code\`, code blocks, links, line breaks). Respond in ENGLISH.`,
  ar: `أنت المساعد الذكي لزيريكس فينسوت — تصرف كالمدير المالي الشخصي لمشروع صغير في تركيا/الشرق الأوسط. اربط كل إجابة بأرقام محددة؛ تجنب النصائح العامة. استخدم الأدوات لاستعلام بيانات المستخدم. فسّر الأرقام، لا تكتفِ بسردها. عند اقتراح إجراء استخدم create_reminder — سيعرضه النظام كزر، ويُطبَّق فقط بعد موافقة المستخدم. صيغة الإجابة Markdown (**عريض**، *مائل*، \`كود\`، كتل كود، روابط، فواصل أسطر). الإجابة بالعربية.`
} as const;

function systemPrompt(locale: "tr" | "en" | "ar"): string {
  return SYS[locale] || SYS.tr;
}

// ─── History → Gemini contents shape ────────────────────────

function loadGeminiHistory(messages: MessageForMemory[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      out.push({ role: "model", parts: [{ text: m.content }] });
    }
    // tool messages are not replayed into history — they're already
    // baked into the assistant turn that consumed them.
  }
  return out;
}

// ─── Engine ─────────────────────────────────────────────────

export async function* streamChat(args: StreamChatArgs): AsyncGenerator<ChatChunk> {
  const t0 = Date.now();

  if (!genAI) {
    yield { event: "error", data: { message: "gemini_not_configured" } };
    yield { event: "done",  data: { messageId: args.placeholderAssistantId, conversationId: args.conversationId, tokensUsed: 0, latencyMs: 0 } };
    return;
  }

  // 1. Load conversation history (excluding the placeholder we'll fill).
  let priorMessages: MessageForMemory[];
  try {
    const rows = await prisma.chatMessage.findMany({
      where:   { conversationId: args.conversationId, id: { not: args.placeholderAssistantId } },
      orderBy: { createdAt: "asc" },
      select:  { id: true, role: true, content: true, tokensUsed: true, createdAt: true }
    });
    priorMessages = rows.map((r) => ({
      id:         r.id,
      role:       r.role,
      content:    r.content,
      tokensUsed: r.tokensUsed,
      createdAt:  r.createdAt
    }));
  } catch (err: any) {
    yield { event: "error", data: { message: `load_history_failed: ${err?.message || err}` } };
    yield { event: "done",  data: { messageId: args.placeholderAssistantId, conversationId: args.conversationId, tokensUsed: 0, latencyMs: Date.now() - t0 } };
    return;
  }

  // 2. Trim to soft cap.
  const trimmed = trimMemoryToCap(priorMessages);

  // 3. Build Gemini config + history.
  const model = genAI.getGenerativeModel({
    model:             "gemini-2.0-flash",
    systemInstruction: systemPrompt(args.locale),
    tools:             [{ functionDeclarations: ALL_TOOLS }]
  });
  let contents: Content[] = loadGeminiHistory(trimmed);

  // Accumulators for the final persisted message.
  let assembledText = "";
  const accumulatedToolCalls:   Array<{ name: string; args: any }>     = [];
  const accumulatedToolResults: Array<{ name: string; result: any }>   = [];
  const accumulatedActions:     Array<{ label: string; type: string; payload: any }> = [];
  const accumulatedCitations:   Array<{ type: string; id: string; label: string }>   = [];
  const accumulatedCharts:      Array<{ type: string; data: any }>     = [];
  let inputTokens  = 0;
  let outputTokens = 0;

  // 4-5. Function-call loop.
  let loops = 0;
  let terminate = false;
  const startTime = Date.now();

  try {
    while (!terminate && loops < MAX_TOOL_LOOPS) {
      loops++;
      if (Date.now() - startTime > STREAM_TIMEOUT_MS) {
        yield { event: "error", data: { message: "stream_timeout" } };
        break;
      }

      const result = await model.generateContentStream({ contents });
      const turnFunctionCalls: FunctionCall[] = [];
      let turnText = "";

      for await (const chunk of result.stream) {
        // Text portion of this chunk (if any).
        let chunkText = "";
        try { chunkText = chunk.text() || ""; } catch { chunkText = ""; }
        if (chunkText) {
          turnText += chunkText;
          assembledText += chunkText;
          yield { event: "token", data: { text: chunkText } };
        }

        // Function calls in this chunk (if any).
        try {
          const calls = chunk.functionCalls();
          if (calls && calls.length > 0) {
            for (const c of calls) turnFunctionCalls.push(c);
          }
        } catch { /* SDK may not have functionCalls() on every chunk; ignore */ }
      }

      // Capture token usage from the full response object.
      try {
        const final = await result.response;
        const usage: any = (final as any).usageMetadata;
        if (usage) {
          inputTokens  += Number(usage.promptTokenCount     || 0);
          outputTokens += Number(usage.candidatesTokenCount || 0);
        }
      } catch { /* tolerable */ }

      if (turnFunctionCalls.length === 0) {
        // Terminal turn — Gemini gave us text and no further tool calls.
        terminate = true;
        break;
      }

      // Append the model's turn (with function calls) into contents.
      contents.push({
        role: "model",
        parts: [
          ...(turnText ? [{ text: turnText }] : []),
          ...turnFunctionCalls.map((fc) => ({ functionCall: fc }))
        ]
      });

      // Execute each tool call serially (small N; preserves order).
      const toolResponseParts: any[] = [];
      for (const call of turnFunctionCalls) {
        const argsObj = (call.args as any) || {};
        accumulatedToolCalls.push({ name: call.name, args: argsObj });
        yield { event: "tool_call", data: { name: call.name, args: argsObj } };

        let dispatch: ToolDispatchResult;
        try {
          dispatch = await dispatchTool({
            name:       call.name,
            args:       argsObj,
            merchantId: args.merchantId
          });
        } catch (err: any) {
          dispatch = {
            name:      call.name,
            result:    { error: "dispatch_threw", message: err?.message || String(err) },
            isProposal: MUTATING_TOOLS.has(call.name),
            latencyMs: 0
          };
        }
        accumulatedToolResults.push({ name: dispatch.name, result: dispatch.result });
        yield { event: "tool_result", data: { name: dispatch.name, result: dispatch.result } };

        // If this tool was a mutation proposal, also surface it as
        // an action button so the UI can render it.
        if (dispatch.isProposal && dispatch.result?.proposal) {
          const prop = dispatch.result.proposal;
          accumulatedActions.push({
            label:   actionLabelFor(prop.type, args.locale),
            type:    String(prop.type),
            payload: prop.payload
          });
          yield {
            event: "action",
            data:  {
              label:   actionLabelFor(prop.type, args.locale),
              type:    String(prop.type),
              payload: prop.payload
            }
          };
        }

        // Derive citations + charts from read-tool results (best-effort).
        const extras = derive(dispatch);
        for (const c of extras.citations) {
          accumulatedCitations.push(c);
          yield { event: "citation", data: c };
        }
        for (const ch of extras.charts) {
          accumulatedCharts.push(ch);
          yield { event: "chart", data: ch };
        }

        // Add the tool response so Gemini can use it on the next loop.
        toolResponseParts.push({
          functionResponse: { name: dispatch.name, response: dispatch.result }
        });
      }

      contents.push({ role: "user", parts: toolResponseParts });
      // Loop continues — next iteration calls generateContentStream
      // with the updated contents that now include tool responses.
    }
  } catch (err: any) {
    yield { event: "error", data: { message: `engine_threw: ${err?.message || String(err)}` } };
  }

  // 6. Persist the final assistant message.
  const tokensUsed = inputTokens + outputTokens || estimateTokens(assembledText);
  const latencyMs  = Date.now() - t0;

  try {
    await prisma.chatMessage.update({
      where: { id: args.placeholderAssistantId },
      data: {
        content:      assembledText,
        toolCalls:    accumulatedToolCalls.length   ? (accumulatedToolCalls   as any) : undefined,
        toolResults:  accumulatedToolResults.length ? (accumulatedToolResults as any) : undefined,
        citations:    accumulatedCitations.length   ? (accumulatedCitations   as any) : undefined,
        charts:       accumulatedCharts.length      ? (accumulatedCharts      as any) : undefined,
        actions:      accumulatedActions.length     ? (accumulatedActions     as any) : undefined,
        tokensUsed,
        inputTokens:  inputTokens  || null,
        outputTokens: outputTokens || null,
        latencyMs
      }
    });
    await prisma.chatConversation.update({
      where: { id: args.conversationId },
      data:  { lastMessageAt: new Date() }
    });

    // Fire-and-forget title generation. Triggers Gemini at most
    // once per conversation (titleGen guards against re-runs by
    // checking the existing title against known defaults).
    void maybeGenerateTitle({
      conversationId: args.conversationId,
      merchantId:     args.merchantId,
      locale:         args.locale
    });
  } catch (err: any) {
    yield { event: "error", data: { message: `persist_failed: ${err?.message || err}` } };
  }

  yield {
    event: "done",
    data:  {
      messageId:      args.placeholderAssistantId,
      conversationId: args.conversationId,
      tokensUsed,
      latencyMs
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────

function actionLabelFor(type: string, locale: "tr" | "en" | "ar"): string {
  if (type === "create_reminder") {
    return locale === "tr" ? "Hatırlatıcı oluştur"
         : locale === "ar" ? "إنشاء تذكير"
                            : "Create reminder";
  }
  return type;
}

interface DerivedExtras {
  citations: Array<{ type: string; id: string; label: string }>;
  charts:    Array<{ type: string; data: any }>;
}

/** Best-effort citation + chart extraction from tool results.
 *  Conservative — only emits when the result shape is recognized. */
function derive(d: ToolDispatchResult): DerivedExtras {
  const out: DerivedExtras = { citations: [], charts: [] };
  if (!d || !d.result) return out;
  const r = d.result;

  if (d.name === "get_kpi_value" && Array.isArray(r.sparkline) && r.sparkline.length > 0) {
    out.charts.push({
      type: "sparkline",
      data: { kpiId: r.kpiId, values: r.sparkline, value: r.value, trendPct: r.trendPct }
    });
  }
  if (d.name === "get_top_customers" && Array.isArray(r.customers)) {
    for (const c of r.customers.slice(0, 5)) {
      out.citations.push({ type: "customer", id: c.name, label: `${c.name} (${Math.round(c.revenue)})` });
    }
  }
  if (d.name === "get_invoices" && Array.isArray(r.invoices)) {
    for (const inv of r.invoices.slice(0, 5)) {
      out.citations.push({ type: "invoice", id: inv.id, label: `${inv.invoiceNumber} · ${inv.customerName}` });
    }
  }
  if (d.name === "get_recent_insights" && Array.isArray(r.insights)) {
    for (const i of r.insights.slice(0, 5)) {
      out.citations.push({ type: "insight", id: i.id, label: i.title });
    }
  }
  if (d.name === "forecast_cash" && typeof r.projectedBalance === "number") {
    out.charts.push({
      type: "cash_forecast",
      data: { currentCash: r.currentCash, dailyBurn: r.dailyBurnEstimate, daysAhead: r.daysAhead, projected: r.projectedBalance }
    });
  }
  return out;
}
