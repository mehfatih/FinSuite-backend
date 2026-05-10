# Email Deliveries Bouncing / Sender Reputation Drop

**Symptom:** Resend webhook (`/api/webhooks/resend`) firing `email.bounced` / `email.complained` events repeatedly. Affected surfaces:
- D-3: insight share emails
- D-5: morning brief sends
- D-6: weekly report sends
- Phase 14: admin email campaigns

**Confirm:**
1. Resend dashboard → Logs → filter `bounced` in the last hour. Cluster by domain.
2. `/admin/email-engagement` page shows the auto-disabled subscriptions (D-5 + D-6 disable after 3 hard bounces).
3. Sentry: `tag:source resend message:"bounced"`.

**Fix order:**
1. **If bounces cluster on a single recipient domain** (e.g. one merchant's accountant address): D-5 / D-6 already auto-disabled. Email Mehmet to manually unblock from `/admin/email-engagement` once the recipient confirms their inbox accepts mail again.
2. **If bounces cluster on OUR sending domain** (Sender Reputation issue):
   - Verify SPF: `dig TXT zyrix.co +short | grep "v=spf1"` should include `include:_spf.resend.com`.
   - Verify DKIM: in Resend dashboard → Domains → zyrix.co → DKIM status should be Verified.
   - DMARC: `dig TXT _dmarc.zyrix.co +short` should return `v=DMARC1`.
   - If any are misconfigured, add the missing record and **wait 24h before sending bulk again**.
3. **If recipient ISP is rejecting** (e.g. Outlook 550 5.7.1): pause campaign sends, file a sender-reputation appeal with the ISP.

**Communicate:**
- Internal: Slack #ops within 10 min of confirmation.
- Customer: only if their account was auto-disabled. Email template lives in `services/morningBrief/sendDisableNotice.ts` (similar for weeklyReport).

**Resolve:** 24h with no new auto-disables AND `/admin/email-engagement?bounced=24h` count drops back to baseline.
