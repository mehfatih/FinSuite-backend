# PDF Service Crash / Puppeteer Pool Exhausted

**Symptom:** Customer-facing PDF endpoints (`/api/customer/pdf/*`, public share PNG at `/og/share/:slug.png`) return 500. Sentry filter: `path:/api/customer/pdf` OR `path:/og/share`.

**Affected surfaces:**
- D-2: PDF export (insight, daily-brief, range-report)
- D-2.5: Puppeteer pool hardening — pool size 1-4 controlled by `PDF_MAX_BROWSERS` (default 2)
- D-7: OG image renderer reuses the same pool

**Confirm:**
1. `curl -fsSL https://finsuite-backend-production.up.railway.app/health` → uptime + database probe; if both ok, the service itself isn't down — it's the Puppeteer pool stuck.
2. Sentry: search for `Target closed`, `Browser disconnected`, `Navigation timeout`. These are the three failure modes from the pool.
3. Railway logs: filter `[pdfRenderer]` — repeated `release` without matching `acquire` means a slot is leaked.

**Fix order:**
1. **Restart the Railway service.** This is the canonical fix; the pool reinitializes clean. Aim for <60s downtime; do NOT restart during a known busy window unless you have to.
2. **If the pool exhausts immediately on restart:** something is holding a browser open. Check for an infinite-loop request or an HTML template that hangs. Recent commits to `services/pdf/templates/*.ts` are the prime suspect.
3. **If Puppeteer can't launch at all** (sentry: `Failed to launch the browser process`): Chromium libs missing on the deploy image. Inspect `nixpacks.toml` — required packages listed there. Adding/removing libs needs Mehmet's approval (infra change).

**Communicate:**
- If >5 min: in-app banner ("Reports take a little longer right now; we're working on it.") via Notification SYSTEM severity.
- Email customers who have a scheduled weekly report due in the affected window — the cron will retry; let them know.

**Resolve:** PDF round-trip on `/api/customer/pdf/insight/<id>` returns 200 + non-empty body.
