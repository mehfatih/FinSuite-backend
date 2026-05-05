import { Router, Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import rateLimit from "express-rate-limit";

const router = Router();

// Strict rate limit for the public demo endpoint
const demoLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 8,                      // 8 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Please wait a moment." },
});

router.post("/analyze-invoices", demoLimiter, async (req: Request, res: Response) => {
  try {
    const { businessType, invoiceVolume, delayRate, opsIntensity, lang } = req.body || {};

    // Lightweight validation (this is a demo, not production data)
    const business = String(businessType || "").trim().slice(0, 80);
    const volume = Math.max(0, Math.min(10_000_000, Number(invoiceVolume) || 0));
    const delay = Math.max(0, Math.min(100, Number(delayRate) || 0));
    const ops = Math.max(0, Math.min(100_000, Number(opsIntensity) || 0));
    const language = ["TR", "AR", "EN"].includes(lang) ? lang : "TR";

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ success: false, error: "AI service unavailable" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });

    const langInstr = {
      TR: "Respond with Turkish 'suggestion' text.",
      AR: "Respond with Arabic 'suggestion' text.",
      EN: "Respond with English 'suggestion' text.",
    }[language as "TR" | "AR" | "EN"];

    const prompt = `You are a senior financial analyst AI for Zyrix FinSuite.

Analyze the following SMB invoice/cashflow profile and produce realistic, varied results that reflect the actual numbers (not generic outputs):

- Business type: "${business || "unspecified"}"
- Monthly invoice volume (currency-agnostic units): ${volume}
- Average delay rate: ${delay}%
- Operations intensity (transactions/month): ${ops}

Compute these four metrics with real reasoning, not constants. Calibrate them based on the inputs:

1. cashflow: integer percentage from -40 to 60. Higher when delay is low and volume is healthy.
2. risk: integer 0-95. Rises with delay rate; small businesses with high delay should score high.
3. priority: integer 0-99 representing count of accounts needing follow-up. Scales with volume*delay.
4. opportunity: integer 0-999 representing automation opportunity in K (thousands). Scales with volume + ops + business potential.

Also produce a 2-line actionable suggestion (each line maximum 12 words, no full stops at the end of either line).

${langInstr}

Return STRICT JSON with this exact shape and nothing else:
{
  "cashflow": <int>,
  "risk": <int>,
  "priority": <int>,
  "opportunity": <int>,
  "suggestion": ["<line 1>", "<line 2>"]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Sometimes the model wraps JSON in fences; strip them and retry
      const cleaned = text.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    // Final clamp to safe ranges
    const safe = {
      cashflow: Math.max(-40, Math.min(60, Math.round(Number(parsed.cashflow) || 0))),
      risk: Math.max(0, Math.min(95, Math.round(Number(parsed.risk) || 0))),
      priority: Math.max(0, Math.min(99, Math.round(Number(parsed.priority) || 0))),
      opportunity: Math.max(0, Math.min(999, Math.round(Number(parsed.opportunity) || 0))),
      suggestion: Array.isArray(parsed.suggestion) && parsed.suggestion.length === 2
        ? parsed.suggestion.map((s: any) => String(s).slice(0, 120))
        : ["Send reminders to priority customers", "Follow up high-risk invoices today"],
    };

    return res.json({ success: true, data: safe });
  } catch (err: any) {
    console.error("[publicAiDemo] error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Analysis failed" });
  }
});

export default router;
