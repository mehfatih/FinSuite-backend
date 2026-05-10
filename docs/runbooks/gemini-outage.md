# Gemini Outage

**Symptom:** AI features fail or time out. Affected surfaces:
- D-1: morning insight cards (`Insight` rows) stop generating
- D-5: morning brief send job logs `gemini_failed`
- D-8: `/chat` SSE stream emits `event: error data: { message }` and shuts
- D-9: `/zyrix today` slash command replies "not ready yet"

**Confirm:**
1. `curl -fsSL https://finsuite-backend-production.up.railway.app/health | jq .data.deps.gemini` → `not_configured` means env var is missing; `ok` means key exists but doesn't say if Google's side is up.
2. Check https://status.cloud.google.com for "Vertex AI" / "Generative Language API".
3. Sentry: filter `tag:source gemini` or `message:"GoogleGenerativeAI"`.

**Fix order:**
1. **If our key is the problem** (sentry shows `403` / `quota_exceeded`):
   - Bump the daily quota in Google Cloud Console → AI Studio → API Keys
   - Or rotate the key: generate a new one, update `GEMINI_API_KEY` on Railway, restart.
2. **If Google's side is down** (status page red):
   - The chat fallback already returns "AI is taking longer than usual; showing cached insights." (D-8 §4.4 strategy F1). No code change needed.
   - Disable morning brief job temporarily: set `MORNING_BRIEF_ENABLED=false` on Railway. Re-enable when status page is green.
3. **If our timeout is too tight** (sentry shows `gemini_timeout` repeatedly under normal Google status):
   - `aiBriefController.ts` uses an 8s timeout. Bumping requires Mehmet's approval (protected file). Add a temporary backend-wide rate limit on AI endpoints first; only edit the controller if rate limit doesn't help.

**Communicate:**
- Internal Slack #ops: "Gemini quota / outage; AI features degraded for ~N min"
- If >30 min: in-app banner via `Notification` system: severity SYSTEM, title "AI is briefly unavailable; reports continue normally."

**Resolve in Sentry:** mark the issue resolved once /health shows gemini=ok and a fresh `/chat` round-trip succeeds.
