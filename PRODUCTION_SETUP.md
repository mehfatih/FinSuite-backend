# Zyrix FinSuite Backend - Production Setup Guide

This guide covers post-deployment configuration on Railway for features built in Sprint 1-3.

## 1. Environment Variables on Railway

Open your Railway project → backend service → **Variables** tab. Add or verify these:

### Required (existing)
- `DATABASE_URL` (auto-provided by Railway Postgres plugin)
- `JWT_SECRET` (64-char random hex)
- `JWT_ADMIN_SECRET` (different 64-char random hex)
- `GEMINI_API_KEY` (from Google AI Studio)
- `RESEND_API_KEY` (from Resend.com)
- `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL`
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_BUSINESS_ID` (from Meta)

### NEW - Add these for Sprint 2+ features

**WHATSAPP_VERIFY_TOKEN** - Required for WhatsApp webhook
- Pick any random string (don't reuse other secrets)
- Generate locally:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Save the same value for use in Meta dashboard (step 2 below)

**CRON_SECRET** - Required for daily reminder cron
- Pick another random string
- Generate the same way as above

After saving, Railway will auto-redeploy your service. Wait for deploy to complete.

---

## 2. Configure WhatsApp Webhook in Meta Dashboard

1. Go to https://developers.facebook.com/apps → your app → **WhatsApp** → **Configuration**
2. Under **Webhook**, click **Edit**
3. **Callback URL**: `https://finsuite-backend-production.up.railway.app/api/whatsapp/webhook`
4. **Verify token**: paste the same value you used for `WHATSAPP_VERIFY_TOKEN`
5. Click **Verify and save**
   - If verification fails, double-check the env var was saved on Railway and the service has redeployed
6. **Webhook fields** - subscribe to:
   - `messages` - inbound customer messages
   - `message_status` - delivered/read receipts
7. Click **Subscribe**

### Test
Send any message to your WhatsApp Business number. Then check the database:
```sql
SELECT * FROM whatsapp_messages WHERE message_type LIKE 'inbound_%' ORDER BY created_at DESC LIMIT 5;
```
Should see the inbound message.

For status updates - send an invoice via WhatsApp from the dashboard. After ~10 seconds, the message status should auto-update from SENT → DELIVERED → READ.

---

## 3. Set Up Daily Reminder Cron

Two options:

### Option A: Railway Cron (recommended)
1. Railway dashboard → backend service → **Settings** → **Cron Schedule** (if available on your plan)
2. Add a scheduled task:
   - Schedule: `0 9 * * *` (daily at 9 AM)
   - Command:
     ```bash
     curl -X POST https://finsuite-backend-production.up.railway.app/api/whatsapp/reminders/run-all -H "x-cron-secret: $CRON_SECRET"
     ```

### Option B: External cron service (free, simpler)
Use https://cron-job.org (free, no signup needed for basic schedules):
1. Register
2. Add new cron job:
   - **Title**: Zyrix FinSuite Daily Reminders
   - **URL**: `https://finsuite-backend-production.up.railway.app/api/whatsapp/reminders/run-all`
   - **Schedule**: Every day at 09:00 (Europe/Istanbul)
   - **Method**: POST
   - **Custom headers**:
     ```
     x-cron-secret: <YOUR_CRON_SECRET_VALUE>
     Content-Type: application/json
     ```
3. Save

### Test Manually
From PowerShell:
```powershell
curl -X POST https://finsuite-backend-production.up.railway.app/api/whatsapp/reminders/run-all -H "x-cron-secret: PASTE_YOUR_SECRET_HERE"
```
Expected response:
```json
{
  "success": true,
  "data": {
    "merchantsProcessed": 5,
    "totals": { "invoicesProcessed": 12, "remindersSent": 3, ... }
  }
}
```

If you get `403 Forbidden`, the secret doesn't match what's set on Railway.

---

## 4. Verify End-to-End

### Provisioning
```powershell
curl https://finsuite-backend-production.up.railway.app/api/plans/catalog
```
Should return 3 plans (eDonusum, onMuhasebe, pro).

### WhatsApp send
1. Login to dashboard at https://finsuite.zyrix.co
2. Go to Invoices → open any invoice → "Send via WhatsApp"
3. Verify the recipient receives the text message
4. Check `/dashboard/whatsapp` - status should show SENT, then update to DELIVERED/READ

### Bank CSV import
1. Go to `/dashboard/banks` → CSV Import tab
2. Upload a sample bank CSV
3. Verify the transactions appear in Transactions tab

### Sprint 3 (RBAC + Audit + IP)
1. Go to `/dashboard/security`
2. Test inviting a user
3. Check Audit Logs tab - should see CREATE event for merchant_user
4. Test IP Allowlist - add `127.0.0.1` to test mode without locking yourself out

---

## 5. Monitoring

### Railway Logs
Railway dashboard → backend service → **Deployments** → latest → **View logs**

Watch for:
- `[whatsapp webhook] error:` - webhook handler issues
- `[audit] failed to log event:` - audit logging failures (non-critical)
- `[ipAllowlist] check failed:` - IP check errors (fails open)

### Database health
Railway Postgres plugin shows query stats. Watch for:
- Slow queries on `whatsapp_messages`, `merchant_audit_logs` (these grow fast)
- Consider archiving rows older than 90 days for `whatsapp_messages` and 1 year for `merchant_audit_logs`

---

## 6. Security Checklist

- [ ] All env vars set on Railway (no placeholders)
- [ ] `JWT_SECRET` and `JWT_ADMIN_SECRET` are different
- [ ] `WHATSAPP_VERIFY_TOKEN` and `CRON_SECRET` are unique strong randoms
- [ ] `BANK_SANDBOX_MODE=true` until real BBM agreements signed
- [ ] No `.env` file committed to git (verify with `git ls-files | grep .env`)
- [ ] `CORS` only allows known frontend origins (check `src/index.ts`)
- [ ] Old GitHub PAT from prior session has been revoked (per handoff doc)

---

## 7. Rollback Plan

If a deploy breaks production:
1. Railway dashboard → backend service → **Deployments**
2. Find last known good deployment → click **Redeploy**
3. Service rolls back in ~30 seconds

For database schema rollbacks:
- Schema changes use `prisma db push --accept-data-loss` (no migrations)
- To undo a column add, manually drop it via Railway Data console:
  ```sql
  ALTER TABLE whatsapp_messages DROP COLUMN <new_column>;
  ```
- Then revert the schema.prisma change in code and redeploy.
