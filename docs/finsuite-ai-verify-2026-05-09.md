# FinSuite — AI Co-Pilot Verification Report

**Date:** 2026-05-09
**Branch:** `main`
**Repo:** `zyrix-finsuite-backend`
**Scope:** Phase C of `finsuite-seed-and-verify.md` — verify `/api/customer/dashboard/ai-brief/refresh` returns `fallback: false` for both seeded test merchants.
**Result:** ❌ **Verification failed.** Both merchants returned `fallback: true`. Root cause identified via diagnostic logging — **the new `GEMINI_API_KEY` works, but the underlying GCP project's quota is `limit: 0`.** Key rotation alone is insufficient; the GCP project needs billing/quota enablement.

---

## Summary

| Step | Result |
|---|---|
| Phase A — discovery doc committed (`2e8218b`) | ✅ |
| Phase B — seed scripts committed (`f5755f4`, `01ae422`, `1a34d06`), pushed | ✅ |
| Phase B — local seed run | ✅ counts match (2 merchants, 6 customers, 24 invoices, 90 bank txns, 72 expenses) |
| Phase C.3 — login as TR merchant | ✅ HTTP 200, JWT issued |
| Phase C.4 — `POST /ai-brief/refresh` (TR) | ⚠ HTTP 200, **`fallback: true`** (canned content) |
| Phase C.6 — login + refresh (SA merchant) | ⚠ HTTP 200, **`fallback: true`** |
| Phase C.7 — diagnostic log review | ✅ root cause: Gemini API returns 429 with `limit: 0` |

---

## Curl commands used

(Tokens captured at runtime, redacted below.)

### TR merchant

```bash
# 1. Login
curl -X POST https://finsuite-backend-production.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test+tr@finsuite.zyrix.co","password":"TestMerchantTR!2026"}'
# → { success: true, data: { token: "<TOKEN_TR>", merchant: { id: "adf1c5e4-…", language: "TR", currency: "TRY", … } } }

# 2. Refresh AI brief
curl -X POST https://finsuite-backend-production.up.railway.app/api/customer/dashboard/ai-brief/refresh \
  -H "Authorization: Bearer <TOKEN_TR>" \
  -H "Content-Type: application/json"
```

> Path corrected from prompt: actual route is `/api/customer/dashboard/ai-brief/refresh` (mounted under `/api/customer/dashboard` in `src/index.ts:92`). Prompt §C.4 had `/api/customer/ai-brief/refresh` — would have 404'd.

### SA merchant

Identical pattern, with body `{"email":"test+sa@finsuite.zyrix.co","password":"TestMerchantSA!2026"}` and `<TOKEN_SA>` substituted.

---

## Responses

### TR — `POST /ai-brief/refresh`

```json
{
  "success": true,
  "data": {
    "brief": {
      "criticalCard": {
        "title": "Bugün acil bir sorun yok",
        "description": "Uzun vadeli fırsatlara odaklan.",
        "actionLabel": "Tahminler",
        "actionRoute": "/predictions/cash"
      },
      "attentionCard": {
        "title": "Vergi takvimini kontrol et",
        "description": "Yaklaşan ödemeler için planlama yap.",
        "actionLabel": "Aç",
        "actionRoute": "/tax/calendar"
      },
      "opportunityCard": {
        "title": "Müşteri sağlığını incele",
        "description": "Yüksek değerli müşteri portföyünü gözden geçir.",
        "actionLabel": "Müşteriler",
        "actionRoute": "/customers/score"
      },
      "generatedAt": "2026-05-09T13:25:13.506Z",
      "focusArea": "all"
    },
    "cached": false,
    "fallback": true
  }
}
```

This is the byte-for-byte content of `FALLBACK_BRIEF` (`aiBriefController.ts:52–71`). The merchant's seeded numbers had no influence on the output, because Gemini was never successfully called.

### SA — `POST /ai-brief/refresh`

```json
{
  "success": true,
  "data": {
    "brief": {
      "criticalCard":    { "title": "Bugün acil bir sorun yok",   "description": "Uzun vadeli fırsatlara odaklan.",    "actionLabel": "Tahminler",   "actionRoute": "/predictions/cash" },
      "attentionCard":   { "title": "Vergi takvimini kontrol et", "description": "Yaklaşan ödemeler için planlama yap.","actionLabel": "Aç",          "actionRoute": "/tax/calendar" },
      "opportunityCard": { "title": "Müşteri sağlığını incele",   "description": "Yüksek değerli müşteri portföyünü gözden geçir.", "actionLabel": "Müşteriler", "actionRoute": "/customers/score" }
      "generatedAt": "2026-05-09T13:27:22.32Z",
      "focusArea": "all"
    },
    "cached": false,
    "fallback": true
  }
}
```

Note: the fallback is hardcoded in Turkish, so the SA merchant's `language: AR` setting had no effect — the fallback response is the same locale regardless of merchant. This is a separate UX issue with `FALLBACK_BRIEF` (out of scope for this prompt; flagged below).

---

## Root cause — Railway logs (verbatim)

The diagnostic logging from commit `1079a7b` fired on the SA call. Critical lines (Railway service `FinSuite-backend`, environment `production`, retrieved via `railway logs --since 2m`):

```
[ai-brief] startup: GEMINI_API_KEY present: true length: 39
…
[ai-brief] callGemini: threw error: [GoogleGenerativeAI Error]: Error fetching from
  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent:
  [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.
  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-2.0-flash
  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,           limit: 0, model: gemini-2.0-flash
  * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,           limit: 0, model: gemini-2.0-flash
  Please retry in 37.71968934s.
```

Decoded:

- **Key validity:** the request reached Google's API and returned a typed quota error, which only happens when the API key authenticates correctly. So the new key works.
- **Failure mode:** `429`, three `limit: 0` quota violations on the free-tier metrics:
  - `generate_content_free_tier_input_token_count` (per-minute input tokens — TPM)
  - `generate_content_free_tier_requests` (per-minute requests — RPM)
  - `generate_content_free_tier_requests` (per-day requests — RPD)
- **Implication:** the GCP project that owns the new key has the **Generative Language API enabled but with no allocated quota** — same observable behavior as the previous `limit: 0` key from the prior project.

This is a project-level configuration issue in GCP, not anything reachable from code.

---

## KPI seeding outcome — what Gemini *would* have seen

Snapshot Gemini would have received for the TR merchant if the call had succeeded (computed from the seeded data):

| Field | Expected value | Source / formula |
|---|---|---|
| `mrr` | ~₺36,600 | One PAID May 2026 invoice (Yılmaz, total 30,500 net + 20% KDV) |
| `mrr_growth_pct` | ~+49% | May (~₺36.6k) vs April (~₺24.6k Kaya invoice) |
| `top_customer_revenue` | ~₺36,600 | Yılmaz dominates current month |
| `cash_balance` | ~+₺30k | sum(IN ≈ ₺246k) − sum(OUT ≈ ₺216k) |
| `cash_runway_days` | ~50 | cash / (last-30d burn ÷ 30) |
| `overdue_receivables` | ~₺75k | 3 invoices: 1 OVERDUE (Yılmaz Jul'25) + 2 SENT past-due (Yılmaz Sep'25, Öztürk Aug'25) |
| `payable_30d` | `null` | Hardcoded EMPTY in registry (no `PurchaseInvoice` schema) |
| `pending_invoices` | 2 | The two SENT-status invoices |
| `new_customers_30d` | 1 | Öztürk Group (createdAt 14 days ago) |
| `customer_health_pct` | ~67% | 2 of 3 with `healthScore ≥ 70` (Yılmaz=85, Kaya=70) |
| `top_customer_revenue` (also) | as above | |
| `tax_burden` | ~₺6,700 | KDV 5,200 + Muhtasar 1,500, both unsubmitted, due in next 30 days |
| `context.invoice_count_30d` | ~2 | The May 2026 invoice + edge of the Apr 2026 one (depending on day boundary) |
| `context.customer_count` | 3 | All seeded customers |

SA merchant has the analogous shape in SAR (~SAR 25k MRR, ~SAR 56k overdue, ~SAR 4.9k VAT due).

Because Gemini was never called successfully, **none** of these numbers appear anywhere in the rendered brief. Verification of the `buildPrompt` → `sanitizeBrief` → `ALLOWED_ROUTES` rewrite path remains untested end-to-end.

---

## Anomalies / side observations

1. **Express `trust proxy` not set** — Railway terminates TLS at its edge and forwards `X-Forwarded-For`. Express's `trust proxy` defaults to `false`, so `express-rate-limit` logs an `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` `ValidationError` on every authenticated request. The library falls back to the connection IP (which is Railway's edge) for keying, meaning the auth rate limit currently rate-limits the *whole platform* against a single bucket per Railway edge IP. Functional but incorrect; out of scope here, but worth a follow-up `app.set("trust proxy", 1)` PR.

2. **`FALLBACK_BRIEF` is Turkish-only.** SA merchant (`language: AR`) received the same Turkish fallback strings. When Gemini works this is invisible; when it falls back it produces a wrong-locale UX for non-TR merchants. Fix is one-liner switch on `language` inside `getBrief`. Out of scope for this prompt (no edits to `aiBriefController.ts` allowed), but worth a follow-up.

3. **Diagnostic logging was essential.** Without commit `1079a7b`'s try/catch logs, `callGemini` would have silently returned null and we'd have no signal beyond `fallback: true`. The verbose `console.error` paid for itself on the very first probe.

---

## What's needed to flip `fallback: false`

This is GCP-side, not code-side:

1. **Confirm which GCP project owns the new key.** Either via the API key string in Google AI Studio (`https://aistudio.google.com/apikey`) or via the Google Cloud Console → APIs & Services → Credentials.
2. **Enable billing on that project.** Free-tier projects show `limit: 0` for Gemini 2.0 models in some regions; attaching a billing account moves the project to Tier 1 with non-zero RPM/TPM quotas.
3. **Verify by retrying the call after billing is attached** — quota changes propagate within minutes. No code change or redeploy needed; the same `GEMINI_API_KEY` will start succeeding.
4. **Alternative if billing is undesirable:** switch to the Vertex AI API (different auth flow, requires service account, but has separate free quotas per project). This *would* require code changes in `aiBriefController.ts`, which the current prompt forbids — so save that path for a follow-up if billing isn't an option.

Once Gemini calls succeed, the rate-limit (60s/merchant) means the test cycle is:
1. Hit `/ai-brief/refresh` → expect `fallback: false` and a Turkish brief that mentions the seeded ~₺36k MRR or the ~₺75k overdue or "Yılmaz" (top customer) by name.
2. Wait 60s, repeat for SA merchant → expect Arabic brief mentioning seeded SAR figures or "الراجحي".
3. The same diagnostic logs that surfaced the quota error will, on success, simply not fire — the controller logs only on failure paths.

---

## Cleanup

The seeded test merchants persist in production. To remove them at any time:

```bash
npm run cleanup:test-merchants
```

This deletes both `test+tr@…` and `test+sa@…` and cascades to their invoices, customers, expenses, bank txns, and tax events. No untracked rows are left behind because all FK relations declare `onDelete: Cascade`.

---

## Commits in this verification round

| SHA | Message |
|---|---|
| `2e8218b` | docs(finsuite): discovery report for test merchant seed |
| `f5755f4` | feat(seed): test merchant seed script for TR + SA |
| `01ae422` | feat(seed): cleanup script for test merchants |
| `1a34d06` | chore(scripts): npm run seed:test-merchants and cleanup:test-merchants |

Plus the prior commit that made this whole investigation possible:

| SHA | Message |
|---|---|
| `1079a7b` | chore(ai-brief): add diagnostic logging to callGemini for fallback debugging |
