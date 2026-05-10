# Slack OAuth Token Expired / Workspace Stops Receiving Messages

**Symptom:** A merchant's Slack channel stops getting insight cards, even though the channel mapping is enabled. `SlackOutboundLog` rows for that installation show `ok=false` with `errorCode: token_revoked` or `not_authed`.

**Affected surfaces:**
- D-9 Slack notification driver
- D-9 slash commands (also fail with 401)
- D-9 interactive buttons (Resolve / Dismiss / Share buttons no longer update the message)

**Confirm:**
1. Find the installation:
   ```sql
   SELECT id, "merchantId", "workspaceName", "uninstalledAt"
   FROM slack_installations WHERE "merchantId" = '<id>';
   ```
2. Check recent failures:
   ```sql
   SELECT "channelId", "errorCode", "rawError", "postedAt"
   FROM slack_outbound_logs
   WHERE "installationId" = '<install-id>'
   ORDER BY "postedAt" DESC LIMIT 20;
   ```
3. Common error codes:
   - `token_revoked` — merchant or admin revoked our app from Slack workspace settings
   - `not_authed` — token bytes corrupted or env vars rotated mid-flight
   - `not_in_channel` — bot got kicked from a specific channel; mapping to others may still work
   - `account_inactive` — workspace itself was deactivated by Slack

**Fix order:**
1. **`token_revoked` / `not_authed` / `account_inactive`:** the merchant has to re-install. Email them with the `/settings/integrations` URL; the existing UI handles re-auth (the OAuth callback's `upsert` rotates the token cleanly).
2. **`not_in_channel`:** bot was removed from one channel; other channels in the same workspace still work. Email the merchant: "Re-add the Zyrix bot to #channel-name in Slack."
3. **If multiple workspaces failed simultaneously** (mass token invalidation): check Slack's status page. If we rotated `SLACK_CLIENT_SECRET`, that doesn't invalidate existing tokens — but if the app was deleted+recreated, all bot tokens died and every merchant has to re-install.

**Communicate:**
- For an individual merchant: email + in-app banner.
- For a mass event: status page entry + bulk email + a temporary banner on `/settings/integrations` explaining the re-install requirement.

**Resolve:** A successful test-send through the `/settings/integrations` UI for the affected merchant returns 200 + a Slack message ts.

**V2 follow-up:** the channel-validation cron from discovery §10.K (deferred post-D-10) will mark stale mappings disabled automatically and notify the merchant in-app, removing most of the manual triage from this runbook.
