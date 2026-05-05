// ============================================================
// Zyrix FinSuite - Receipt Scan Service
// Sprint 1 Phase 1A - Feature 2
//
// Uses Gemini 1.5 Flash (vision-capable) to extract structured
// data from a receipt image. The free tier is generous enough
// for early-stage usage; we will switch to Google Cloud Vision
// before public launch (tracked in product roadmap).
//
// Returns a normalized payload that maps cleanly onto the
// Expense table fields.
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type ReceiptParseResult = {
  success: boolean;
  data?: {
    vendor: string | null;
    amount: number | null;
    currency: string;
    date: string | null;          // ISO 8601 date "YYYY-MM-DD"
    category: string | null;
    description: string | null;
    taxAmount: number | null;
    taxRate: number | null;       // percent, e.g. 18 for 18%
    rawText?: string;             // full receipt text for audit
  };
  error?: string;
};

// ----------------------------------------------------------------
// Prompt: instructs the model to return strict JSON only
// ----------------------------------------------------------------

const PROMPT = `You are a receipt OCR engine. Analyze the attached image of a receipt or invoice and extract these fields.

Return ONLY a single JSON object with this exact shape (no Markdown, no commentary, no code fences):
{
  "vendor": string | null,
  "amount": number | null,
  "currency": string,
  "date": string | null,
  "category": string | null,
  "description": string | null,
  "taxAmount": number | null,
  "taxRate": number | null,
  "rawText": string
}

Rules:
- "vendor": the merchant or business name printed on the receipt.
- "amount": the FINAL total paid, including tax. A number, no currency symbols.
- "currency": ISO 4217 code. Default "TRY" if the receipt is Turkish, otherwise infer (e.g. "USD", "SAR", "EUR"). If clearly unknown, use "TRY".
- "date": the date of the transaction in YYYY-MM-DD format. Null if not visible.
- "category": one short word in English describing the spend (e.g. "fuel", "food", "office", "transport", "utility", "telecom", "other").
- "description": a one-line human description of what was bought (e.g. "5 items at SuperMarket"). Keep it under 120 characters.
- "taxAmount": the VAT/KDV amount in the same currency as "amount". Null if not shown.
- "taxRate": the VAT/KDV rate as a percent number (e.g. 18 for 18%, 8 for 8%). Null if not shown.
- "rawText": all text you can see on the receipt, verbatim, in original language and order.

Output JSON only. Do not wrap in code fences.`;

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.,-]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (isFinite(n)) return n;
  }
  return null;
}

function safeString(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // Try Date.parse fallback
  const parsed = new Date(t);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const d = String(parsed.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  return null;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Send a receipt image (base64 string) to Gemini Vision and
 * return a normalized parse result.
 *
 * mimeType examples: "image/jpeg", "image/png", "image/webp"
 */
export async function scanReceipt(
  imageBase64: string,
  mimeType: string
): Promise<ReceiptParseResult> {
  if (!env.geminiApiKey) {
    return {
      success: false,
      error: "GEMINI_API_KEY is not configured on the server",
    };
  }

  if (!imageBase64 || imageBase64.length < 100) {
    return { success: false, error: "Image data is empty or invalid" };
  }

  // Strip data URL prefix if present
  let pureBase64 = imageBase64;
  const m = pureBase64.match(/^data:([^;]+);base64,(.*)$/);
  if (m) {
    pureBase64 = m[2];
    if (!mimeType) mimeType = m[1];
  }

  if (!mimeType) mimeType = "image/jpeg";

  let rawResponseText = "";

  try {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const result = await model.generateContent([
      { text: PROMPT },
      {
        inlineData: {
          data: pureBase64,
          mimeType: mimeType,
        },
      },
    ]);

    rawResponseText = result.response.text();
    const cleaned = stripCodeFences(rawResponseText);

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (jsonErr) {
      return {
        success: false,
        error: "Could not parse Gemini response as JSON",
      };
    }

    return {
      success: true,
      data: {
        vendor:      safeString(parsed.vendor, 200),
        amount:      safeNumber(parsed.amount),
        currency:    (safeString(parsed.currency, 8) || "TRY").toUpperCase(),
        date:        normalizeIsoDate(parsed.date),
        category:    safeString(parsed.category, 30),
        description: safeString(parsed.description, 200),
        taxAmount:   safeNumber(parsed.taxAmount),
        taxRate:     safeNumber(parsed.taxRate),
        rawText:     safeString(parsed.rawText, 5000) || undefined,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Never leak the raw image data into logs
    // eslint-disable-next-line no-console
    console.error("[receiptScan] gemini error:", message);
    return {
      success: false,
      error: "Vision API error: " + message,
    };
  }
}
