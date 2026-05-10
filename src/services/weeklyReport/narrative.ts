// ================================================================
// Sprint D-6 — Gemini-backed weekly narrative composition.
//
// B.2 (this commit) ships a deterministic placeholder so the
// generator + downstream pipeline are wireable end-to-end. B.3
// replaces this body with the real Gemini call (long-form prompt,
// 8s timeout, validation, fallback).
// ================================================================
import type { WeeklySnapshot } from "./weeklyKpis";

export interface ComposeArgs {
  snapshot:     WeeklySnapshot;
  merchantName: string;
  insights:     Array<{ type: string; title: string; body: string }>;
  language:     "tr" | "en" | "ar";
}

const PLACEHOLDER = {
  tr: "Bu haftaki performans yorumun, AI Co-Pilot tarafından hazırlanıyor.",
  en: "Your weekly performance commentary is being prepared by the AI Co-Pilot.",
  ar: "يتم إعداد تعليق الأداء الأسبوعي من قبل المساعد الذكي."
} as const;

export async function composeNarrative(args: ComposeArgs): Promise<string> {
  // B.3 replaces this body with the real Gemini orchestration.
  return PLACEHOLDER[args.language] || PLACEHOLDER.tr;
}
