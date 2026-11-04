# n8n integration

Workflow exports are in [n8n/workflows](../n8n/workflows). They are **generated** by `npm run n8n:build` from the readable Code-node sources in [n8n/code](../n8n/code), so the logic can be linted, reviewed and unit-tested ([tests/n8n](../tests/n8n/workflows.test.ts)); the JSON is committed and CI fails if it drifts. Workflow ids are stable, so re-importing updates in place.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| **A. Request notifications** (`request-notification.json`) | Webhook `POST /webhook/lendloop/request-events` | Verify HMAC → respond 202 → claim → build email → send (3 tries) → report `sent` / `failed` |
| **B. Overdue reminders** (`overdue-reminders.json`) | Schedule, daily 09:00 | Convex sweep → per reminder: claim → email → report |
| **C. Error handler** (`error-handler.json`) | Error Trigger, set as `errorWorkflow` of A and B | Reduce the failure to workflow name, execution id and category → `POST /n8n/errors` |

Never activate workflow C by hand: n8n runs it automatically when another workflow references it.

Every call from n8n to Convex goes through a **Sign** Code node followed by an HTTP Request node (see [Signing](#n8n--convex)).

## Events

| Event | Recipient (decided by Convex, re-checked by n8n) | Message |
| --- | --- | --- |
| `request.created` | lender | New request for *tool*, dates, note, link to Incoming Requests |
| `request.approved` / `request.declined` | borrower | Outcome, dates, next step |
| `request.cancelled` | lender | Borrower cancelled, no action needed |
| `loan.overdue_reminder` | borrower | Tool, due date, days overdue |

## Convex → n8n

Payload schema v1 (one recipient, no Convex or Clerk ids, no tokens):

```json
{
  "schemaVersion": 1,
  "eventId": "request.created:<requestId>",
  "deliveryId": "<uuid, unique per attempt>",
  "eventType": "request.created",
  "correlationId": "<uuid, stable per event>",
  "attempt": 1,
  "recipient": { "role": "lender", "name": "Lena", "email": "lena@example.com" },
  "counterpartName": "Ben",
  "tool": { "name": "Cordless drill" },
  "request": { "status": "pending", "startDate": "2026-11-10", "endDate": "2026-11-12", "message": "..." },
  "actionUrl": "https://app.example.com/requests/incoming"
}
```

Signing (version `v1`):

```
X-LendLoop-Timestamp:   Unix seconds
X-LendLoop-Delivery-Id: unique per attempt
X-LendLoop-Signature:   v1=<hex HMAC-SHA256>
signature = HMAC_SHA256(CONVEX_N8N_WEBHOOK_SECRET, "v1:" + timestamp + ":" + deliveryId + ":" + rawBody)
```

- **Raw bytes, not re-serialised JSON.** The Webhook node has Raw Body enabled and the Code node hashes `getBinaryDataBuffer()`. An interoperability test signs a body with odd whitespace and non-ASCII characters and checks that n8n verifies it.
- **Constant-time comparison**, and malformed signatures (wrong prefix, case, length) are rejected before any HMAC work.
- **Freshness:** `|now − timestamp| ≤ 300 s`, otherwise 401 `stale_request`; future-dated requests are rejected too.
- **Replay protection** is layered and honestly scoped: (1) the 5-minute window bounds a captured request's lifetime; (2) Convex's `/n8n/events/claim` accepts each signed `deliveryId` **once** and grants a 10-minute lease per event, so a replay or duplicate cannot trigger a second send. An n8n-side replay cache was tried and removed (see [decisions](decisions.md)).
- **Payload validation** in n8n: schema version, id formats, UUID, email, ISO dates, lengths, `http(s)` action URL, body `deliveryId` equal to the signed header, and recipient role and status matching the event type.

## n8n → Convex

`POST {CONVEX_SITE_URL}/n8n/...` with `Authorization: Bearer N8N_CONVEX_API_SECRET` (a different secret from the HMAC key; a test confirms the HMAC key is refused as a credential). Order of checks: configured → bearer (constant-time) → body size (32 KB) → signature → rate limit (600/min) → JSON → strict Zod schema → run. Responses are terse, never include stack traces or payloads, and nothing is processed before authentication.

**Optional second factor.** When `N8N_CONVEX_SIGNING_SECRET` is set in Convex, each call must also carry `X-LendLoop-Timestamp` and `X-LendLoop-Signature = v1=HMAC-SHA256(secret, "v1:" + timestamp + ":" + route + ":" + body)` within ±300 s. The route takes the place of the delivery id so a signature for one endpoint cannot be replayed against another. Unset keeps bearer-only behaviour; set but shorter than 32 characters fails closed with 503.

| Endpoint | Purpose |
| --- | --- |
| `/n8n/events/claim` | "May I send?" Refuses sent or skipped events, replayed deliveries, concurrent claims, never-dispatched events, and reminders whose loan was returned |
| `/n8n/events/result` | Idempotent write-back: `sent` is final and never downgraded; repeats are no-ops; retryable failures reschedule |
| `/n8n/overdue/run` | Marks past-due `active` loans `overdue`, creates today's reminder events, returns only what the email needs |
| `/n8n/errors` | Records a workflow failure (name, execution id, coarse category). Free-text messages are rejected by the schema |

## Reliability

- **Transactional outbox.** `requests.create/approve/decline/cancel` insert the `automationEvents` row **and** schedule the dispatcher in the same transaction as the business change. A rollback leaves neither; a commit guarantees delivery will be attempted even if n8n is down.
- **States:** `pending → processing → sent | failed` (plus `skipped` for returned loans). An HTTP 2xx from n8n only means *accepted*: the event stays `processing` until n8n reports the real send result. No report within 5 minutes → `failed: ACK_TIMEOUT`.
- **Retries.** Convex: up to 5 attempts with exponential backoff (30 s, 60 s, 2 min, …), retrying network errors, timeouts and 408/425/429/5xx; other 4xx and bad configuration are permanent. n8n: HTTP and email nodes retry 3 times; a send failure is classified (`SMTP_TIMEOUT`, `SMTP_AUTH`, …) and reported with a `retryable` hint. Nothing retries forever, and the error workflow has no error workflow of its own.
- **Watchdog.** A Convex cron (every 10 minutes) re-dispatches `pending`/`failed` events whose scheduled job never ran and fails events stuck in `processing` past the ack timeout plus grace. Exhausted events are left for an admin.
- **Idempotency keys:** `request.<type>:<requestId>`, `overdue-reminder:<loanId>:<YYYY-MM-DD>`, `workflow-error:<workflow>:<executionId>`, enforced by `by_eventKey` get-or-create inside Convex rather than in n8n.
- **Correlation:** each event has a `correlationId` (also sent as `X-LendLoop-Correlation-Id`), shown in the admin Automation tab and carried in the payload.
- **Visibility:** admins see every event (status, attempts, error code, workflow and execution id) under **Admin → Automation**; members see their own recent notifications on the dashboard.

## Trade-offs

Delivery is at-least-once with a Convex-side duplicate guard, not exactly-once. The one residual window is "n8n sent the email, then crashed before reporting", which after the 5-minute timeout and a retry can produce one duplicate email. n8n reads secrets through `$env`, so anyone who can *edit workflows* can read them; acceptable for a single-operator deployment, not for production (see the README's production notes).
