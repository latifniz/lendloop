# Security

## Threat model

| # | Threat | Mitigation | Verified by |
| --- | --- | --- | --- |
| 1 | A signed-out visitor reads member data | Public query returns only `{name, category}` (`returns` allow-list); every other function requires a verified token | `authorization.test.ts`; browser test on the real payload |
| 2 | A member acts on someone else's data (IDOR) | Ids are looked up, then ownership or participation is checked; outsiders get `NOT_FOUND` | `authorization.test.ts`; browser test opening another member's edit URL |
| 3 | A member escalates to admin | No public function changes roles; `requireAdmin` on admin functions; role changes only via the CLI and audited | `authorization.test.ts`, `audit.test.ts`; browser test on `/admin` |
| 4 | Double-booking by racing approvals | Overlap re-checked at approval inside one serializable transaction | `business-rules.test.ts`; browser test of the refusal |
| 5 | Forged or tampered webhook to n8n | HMAC over timestamp, delivery id and raw body; constant-time compare; ±300 s window | `workflows.test.ts` (tamper, stale, malformed, wrong key); live n8n check |
| 6 | Replayed webhook sends a second email | Convex `claim` accepts each `deliveryId` once and holds a per-event lease | `automation.test.ts` |
| 7 | Forged call to the Convex HTTP endpoints | Bearer secret (constant-time), optional HMAC over route and body, body cap, rate limit, strict schema; HMAC key is not accepted as a bearer token | `automation.test.ts`; live signed / mismatched / bearer-only check |
| 8 | Duplicate or lost notifications | Outbox, deterministic idempotency keys, idempotent write-backs, retries, watchdog | `automation.test.ts` |
| 9 | Secrets leak through the repo or exported workflows | Secrets only in env vars and n8n credentials; workflows hold `$env` references and a credential *name* | scan tests on the exported JSON; secret scan before publishing |
| 10 | Injection and XSS | React escapes output; email HTML escapes user text and strips newlines from subjects; Zod and Convex validators on every input; strict CSP | `workflows.test.ts` (header injection), browser test of an HTML listing name, CSP browser test |
| 11 | Clickjacking and content sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff` | browser test of the headers |
| 12 | Abuse of the n8n endpoints | Fixed-window rate limit, 32 KB body cap, no work before authentication | `automation.test.ts` |
| 13 | Privileged actions go unnoticed | Append-only audit log written in the action's transaction | `audit.test.ts` |
| 14 | Personal data over-collected or over-shared | One recipient per event, no ids or tokens in payloads, events and audit logs hold no emails or message text ([data map](data-map.md)) | `automation.test.ts` (minimised payload), `audit.test.ts` |

## OWASP Top 10 (2021) mapping

| Category | How it is addressed |
| --- | --- |
| A01 Broken access control | Backend RBAC in every function, IDOR-safe lookups, internal-only role changes ([matrix](authorization.md)) |
| A02 Cryptographic failures | TLS everywhere (Vercel, Coolify/Let's Encrypt, Convex); HMAC-SHA256 with constant-time comparison; credentials encrypted by n8n |
| A03 Injection | Validators and Zod on all inputs; no string-built queries; escaped email HTML; CSP |
| A04 Insecure design | Outbox, claim/lease replay guard, deterministic idempotency, ack-vs-delivered ([decisions](decisions.md)) |
| A05 Security misconfiguration | Pinned n8n image, localhost-bound local ports, fail-closed environment validation, security headers and CSP |
| A06 Vulnerable components | `npm audit` in review (one moderate dev-only advisory in the ESLint toolchain); Dependabot-style updates recommended |
| A07 Identification and authentication failures | Clerk handles credentials and sessions; Convex verifies every token |
| A08 Software and data integrity failures | Signed webhooks; generated workflow JSON checked in CI; lockfile |
| A09 Logging and monitoring failures | Correlation ids, admin event view, audit log, watchdog; logs never contain secrets, payloads or addresses |
| A10 Server-side request forgery | The only outbound call is to the configured `N8N_WEBHOOK_URL` (https, or http for localhost), validated at use |

## Secrets

| Secret | Lives in | Purpose |
| --- | --- | --- |
| `CONVEX_N8N_WEBHOOK_SECRET` | Convex env, n8n env | HMAC key, Convex → n8n |
| `N8N_CONVEX_API_SECRET` | Convex env, n8n env | Bearer, n8n → Convex |
| `N8N_CONVEX_SIGNING_SECRET` (optional) | Convex env, n8n env | HMAC second factor, n8n → Convex |
| `N8N_ENCRYPTION_KEY` | n8n env only | Encrypts stored n8n credentials; never rotate casually |
| `CLERK_SECRET_KEY` | Vercel env | Clerk backend key (never `NEXT_PUBLIC_*`) |
| SMTP password / API key | n8n credential | Sending email |

Server secrets are at least 32 characters and are validated where used: a missing or short secret makes the endpoint or dispatcher fail closed with a log that names the variable, never its value.

## Known gaps

- The Clerk instance is a development instance (banner, bot checks); production needs a custom domain.
- n8n reads secrets via `$env`, so anyone who can edit workflows can read them.
- The optional signing second factor is off by default.
- No per-IP rate limiting or WAF in front of `/n8n/*`.
- Audit log, events and rate-limit rows are not yet purged on a schedule.
