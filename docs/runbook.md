# Runbook

## A notification did not arrive

1. **Admin → Automation → Failed.** Each event shows its status, attempts, error code, workflow and execution id, and a correlation id.
2. Read the error code:
   | Code | Meaning | Fix |
   | --- | --- | --- |
   | `NETWORK_ERROR`, `N8N_HTTP_5xx` | Convex could not reach n8n | check n8n is up (`/healthz`) and `N8N_WEBHOOK_URL` is reachable from Convex |
   | `CONFIG_INVALID` | missing or invalid Convex env var | `npx convex env list`; fix the named variable |
   | `ACK_TIMEOUT` | n8n accepted but never reported a result | open the execution in n8n using the execution id |
   | `SMTP_*` | email provider refused | check the SMTP credential and sender domain |
   | `NO_RECIPIENT_EMAIL` | the member's token has no email | add the `email` claim in Clerk's session token |
3. After fixing the cause, press **Retry**. It resets attempts and re-dispatches, and is written to the audit log.
4. A **watchdog** runs every 10 minutes and re-arms events whose scheduled retry never ran. Events that used all 5 attempts are left for a human.

Re-running an n8n execution cannot double-send: Convex's `claim` refuses events already sent.

## n8n is down

Requests and approvals still work. Events stay `pending` or `failed` in Convex and are delivered when n8n returns (automatic retries with backoff, then the watchdog, then manual Retry). Reminders are re-listed on the next daily sweep.

## Rotating a secret

| Secret | Change in | Then |
| --- | --- | --- |
| `CONVEX_N8N_WEBHOOK_SECRET` | Convex env **and** n8n env | restart n8n |
| `N8N_CONVEX_API_SECRET` | Convex env **and** n8n env | restart n8n |
| `N8N_CONVEX_SIGNING_SECRET` (optional) | Convex env **and** n8n env | set n8n first when turning it on or off; a mismatch fails closed and visibly |
| `N8N_ENCRYPTION_KEY` | do **not** change | it encrypts stored credentials; back it up |

## Making someone an admin

They sign in once, then:
```bash
npx convex run users:setRole '{"clerkId":"user_XXXX","role":"admin"}'
```
The change appears in **Admin → Audit log** as "Convex dashboard".

## Overdue reminders

Workflow B runs daily at 09:00. To run it now, open it in n8n and press **Execute workflow**. It marks past-due loans overdue and lists today's reminders; each reminder has a per-day idempotency key, so running it twice sends once.

## Deploys

- Vercel builds with `npx convex deploy --cmd 'npm run build'`, so a push to `main` deploys the Convex functions and the app together.
- Coolify rebuilds the n8n image on push; workflows are imported and activated by the container entrypoint. Never activate the **Error handler** workflow by hand.
