// ================================================================
// Sprint D-8 — Conversation title auto-generation.
//
// After a few turns, replace the default "New Conversation" /
// first-line-truncated title with a Gemini-generated 5-word summary.
// Triggered fire-and-forget by the streaming engine after each
// assistant turn persists.
//
// Cheap: short prompt (~250 tokens), short output (~12 tokens),
// 4-second timeout. Skipped if the conversation already has a
// human-edited title (we detect that by comparing against the
// known default + first-line prefix patterns).
// ================================================================
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../../config/database";
import { env } from "../../config/env";

const TIMEOUT_MS  = 4_000;
const MIN_TURNS   = 2;     // 2 user + 2 assistant minimum
const MAX_TITLE_LEN = 60;

const genAI = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

const SYS = {
  tr: "Bir KOBİ sahibinin AI Co-Pilot'u ile yaptığı sohbeti aşağıdaki mesajlara bakarak EN FAZLA 5 kelime ile özetle. Sadece özeti yaz, başka bir şey yazma. Tırnak kullanma.",
  en: "Summarize the following conversation between a Turkey/MENA SMB owner and their AI Co-Pilot in AT MOST 5 words. Output only the summary, nothing else. No quotes.",
  ar: "لخّص المحادثة التالية بين صاحب مشروع صغير ومساعده الذكي في خمس كلمات كحد أقصى. اكتب الملخص فقط دون أي شيء آخر. بدون علامات اقتباس."
} as const;

function isDefaultTitle(title: string, firstUserMessage: string): boolean {
  if (!title) return true;
  if (title === "New Conversation") return true;
  // The postMessage controller's defaultTitle() truncates the user's
  // first line to 60 chars. If the conversation title still matches
  // that prefix, it's not been hand-edited.
  const truncated = (firstUserMessage || "").trim().split(/\r?\n/)[0]?.slice(0, 60);
  if (truncated && title === truncated) return true;
  return false;
}

function clampTitle(s: string): string {
  return s
    .replace(/^["'`「『]+|["'`」』]+$/g, "")  // strip leading/trailing quotes
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LEN);
}

export async function maybeGenerateTitle(args: {
  conversationId: string;
  merchantId:     string;
  locale:         "tr" | "en" | "ar";
}): Promise<void> {
  if (!genAI) return;

  try {
    // Verify conversation belongs to the merchant + check if eligible.
    const conv = await prisma.chatConversation.findFirst({
      where:  { id: args.conversationId, merchantId: args.merchantId },
      select: { id: true, title: true }
    });
    if (!conv) return;

    const messages = await prisma.chatMessage.findMany({
      where:   { conversationId: args.conversationId },
      orderBy: { createdAt: "asc" },
      take:    8,
      select:  { role: true, content: true }
    });

    // Need at least MIN_TURNS user + MIN_TURNS assistant pairs.
    const userCount = messages.filter((m) => m.role === "user").length;
    const asstCount = messages.filter((m) => m.role === "assistant").length;
    if (userCount < MIN_TURNS || asstCount < MIN_TURNS) return;

    const firstUser = messages.find((m) => m.role === "user")?.content || "";
    if (!isDefaultTitle(conv.title, firstUser)) return;

    // Build a compact transcript (truncate each message to 200 chars).
    const transcript = messages.map((m) => {
      const tag = m.role === "user" ? "U" : m.role === "assistant" ? "A" : "T";
      const c = (m.content || "").replace(/\s+/g, " ").slice(0, 200);
      return `${tag}: ${c}`;
    }).join("\n");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `${SYS[args.locale] || SYS.tr}\n\n${transcript}`;

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))
    ]);
    if (!result) return;

    const text = (result as any).response?.text?.() || "";
    const cleaned = clampTitle(text);
    if (!cleaned || cleaned.length < 3) return;

    await prisma.chatConversation.update({
      where: { id: args.conversationId },
      data:  { title: cleaned }
    });
  } catch (err: any) {
    console.error(`[chat/titleGen] failed for ${args.conversationId}:`, err?.message || err);
  }
}
