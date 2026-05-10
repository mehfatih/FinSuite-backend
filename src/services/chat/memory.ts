// ================================================================
// Sprint D-8 — Chat memory / context window management.
//
// Decision §7.F option F1: drop oldest user/assistant pairs when
// the running token estimate exceeds a soft cap.
//
// Spec hard rule: 8K total tokens. We use 6K as the soft cap so
// the system prompt + tool definitions + the new user message +
// expected response have headroom inside the 8K ceiling.
//
// Token estimation (no external tokenizer): 1 token ~= 4 chars
// for Latin scripts; ~3.5 chars for Turkish/Arabic. We use 3.8 as
// a conservative compromise. Always rounds UP so we never
// underestimate.
//
// V2 promotes to side-summarization when context loss bites users.
// ================================================================

const SOFT_CAP_TOKENS  = 6_000;
const CHARS_PER_TOKEN  = 3.8;

export interface MessageForMemory {
  id:             string;
  role:           string;            // 'user' | 'assistant' | 'tool'
  content:        string;
  tokensUsed:     number | null;     // engine-computed (Gemini-reported) when available
  createdAt:      Date;
}

/** Estimate token count for a single message. */
export function estimateTokens(content: string): number {
  if (!content) return 0;
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

/** Sum tokens across messages, preferring stored tokensUsed when present. */
export function sumTokens(messages: MessageForMemory[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.tokensUsed && m.tokensUsed > 0) {
      total += m.tokensUsed;
    } else {
      total += estimateTokens(m.content);
    }
  }
  return total;
}

/**
 * Trim the oldest user/assistant pairs until total tokens fit
 * inside SOFT_CAP_TOKENS. Tool messages are kept attached to the
 * assistant message that triggered them (we drop a whole turn at
 * a time: user → assistant → optional tool calls → optional tool
 * results, treated as a single dropping unit by createdAt order).
 *
 * The MOST RECENT messages are always preserved (caller's
 * just-posted user message is at the end of the array).
 */
export function trimMemoryToCap(messages: MessageForMemory[]): MessageForMemory[] {
  if (messages.length === 0) return messages;
  let total = sumTokens(messages);
  if (total <= SOFT_CAP_TOKENS) return messages;

  // Sort defensively (caller is expected to pass in createdAt order
  // already, but trimming is order-sensitive).
  const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let cursor = 0;
  while (total > SOFT_CAP_TOKENS && cursor < sorted.length - 1) {
    // Drop one message; if it's a 'user', also drop the immediately-
    // following 'assistant' + 'tool' messages so we never leave a
    // dangling user message without its assistant pair.
    const dropped = sorted[cursor];
    total -= dropped.tokensUsed ?? estimateTokens(dropped.content);
    cursor++;
    if (dropped.role === "user") {
      while (
        cursor < sorted.length - 1 &&
        (sorted[cursor].role === "assistant" || sorted[cursor].role === "tool")
      ) {
        total -= sorted[cursor].tokensUsed ?? estimateTokens(sorted[cursor].content);
        cursor++;
      }
    }
  }

  return sorted.slice(cursor);
}

/** Diagnostic helper for the engine + admin dashboard. */
export function memorySnapshot(messages: MessageForMemory[]): {
  totalTokens:   number;
  messageCount:  number;
  withinSoftCap: boolean;
} {
  const totalTokens = sumTokens(messages);
  return {
    totalTokens,
    messageCount:  messages.length,
    withinSoftCap: totalTokens <= SOFT_CAP_TOKENS
  };
}

export const SOFT_CAP = SOFT_CAP_TOKENS;
