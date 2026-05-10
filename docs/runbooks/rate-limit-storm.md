# Rate Limit Storm / Single-Merchant Flood

**Symptom:** 429 responses spike sharply. `globalRateLimiter` is hit; Railway shows elevated CPU but no error rate. Or one merchant's traffic dwarfs everyone else's.

**Affected surfaces:** any auth-required endpoint, but especially `/api/customer/chat/messages` (D-8 SSE expensive) and `/api/customer/pdf/*` (D-2 Puppeteer expensive).

**Confirm:**
1. `/health` → still 200; this is a load problem, not a crash.
2. Sentry: filter status code 429; group by `tags.merchantId` (set by errorHandler since D-10).
3. Railway logs: `req.requestId` correlation — if 80% of requests in the last 10 min came from one merchant, you found the source.

**Fix order:**
1. **Identify the merchant** from Sentry's merchantId tag or Railway log filter.
2. **Decide why:**
   - Bug in their integration retry-looping? → contact them.
   - Legitimate burst (data import, bulk action)? → temporarily widen global rate limit OR add a per-merchant carve-out.
   - Adversarial / scraping? → block at the auth level: temporarily set `Merchant.archivedAt` to a recent date and they get 401 on next request.
3. **If global rate limit is too tight under normal load** (after merchant-isolation): bump `globalRateLimiter` window/max in `middleware/rateLimiter.ts` — this counts as an infra-adjacent edit; Mehmet sign-off recommended but not required for a temporary widening.

**Per-merchant rate limit (V2 work):** D-9's slack channel driver has a 1-second per-channel debounce. The same pattern can apply per-merchant on `/chat`. Not built in V1; capture as a follow-up if a real flood happens.

**Communicate:**
- If we're throttling a real merchant (not adversarial): email Mehmet so he can call them; never silently throttle a paying customer.

**Resolve:** 429 rate returns to baseline (typically <0.5% of requests) AND no single merchant accounts for >40% of traffic.
