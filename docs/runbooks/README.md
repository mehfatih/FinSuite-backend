# Zyrix FinSuite — Operations Runbooks

These runbooks document how to respond to known production incidents
without needing to read source code. Each one is short on purpose:
when paged at 3am, the responder needs the four facts (what's
broken, how to confirm, how to fix, who to tell) — not a tour of
the architecture.

| Runbook | Trigger |
|---|---|
| [gemini-outage.md](./gemini-outage.md) | AI brief / chat / slash commands fail or time out |
| [pdf-service-crash.md](./pdf-service-crash.md) | Customer PDFs / OG images fail; 500s from /api/customer/pdf |
| [email-bouncing.md](./email-bouncing.md) | Resend deliveries failing / sender reputation drop |
| [rate-limit-storm.md](./rate-limit-storm.md) | Sudden 429 spike or one merchant flooding endpoints |
| [data-corruption.md](./data-corruption.md) | KPI / Insight values look wrong to a customer |
| [oauth-token-expiry.md](./oauth-token-expiry.md) | Slack workspace stops receiving messages |

## Conventions

- All runbooks reference Railway env vars and the public Railway dashboard. If those move (e.g. host change), update §Environment of every runbook in one PR.
- Every runbook includes a Sentry triage link template (`https://sentry.io/.../?query=…`) so the responder doesn't have to remember Sentry's filter syntax.
- "Communicate" is always the second-to-last step. Customers find out about outages from us, not from refreshing.
- "Resolve in Sentry" is the last step. An open Sentry issue is the page; closing it is the all-clear.

## When to write a new runbook

Add a runbook the first time we encounter an incident type, even if it's a one-off — the next person who hits it is rarely the same person, and they'll have less context than you do right now.
