# LendLoop

> **Borrow what you need. Lend what you don't.**

LendLoop is a neighborhood tool-lending platform. Members list tools they can lend, browse what neighbors offer, request tools for a date range, approve or decline requests, track loans and mark tools as returned. Two n8n workflows automate notifications: borrow-request / status-change emails and a daily overdue-loan reminder.

- [Status: what is verified and what is not](#status-what-is-verified-and-what-is-not)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [Authentication and authorization](#authentication-and-authorization)
- [Business rules](#business-rules)
- [Automation (n8n)](#automation-n8n)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Security and privacy decisions](#security-and-privacy-decisions)
- [What I would change before production](#what-i-would-change-before-production)
- [Known limitations](#known-limitations)

## Status: what is verified and what is not

| Area | State | Evidence |
| --- | --- | --- |
| Convex backend logic (auth, RBAC, IDOR, state machines, overlap rule, outbox, HTTP endpoints, idempotency) | **Verified** | 149 automated tests against `convex-test`, an in-memory Convex runtime |
| Convex-to-n8n signing and n8n signature verification | **Verified end to end** | The real Convex signer (`convex/lib/signing.ts`) signed requests that a real n8n 1.123.92 container accepted; bad/stale/malformed/tampered requests were rejected (401/400) |
| n8n workflows (import, activation, email via Mailpit, claim/result write-backs, retries, SMTP failure path, error workflow) | **Verified** against a *mock* Convex HTTP server | Exported JSON imported with `n8n import:workflow`; emails observed in Mailpit; mock recorded the exact calls |
| Next.js app | **Compiles and renders** | `tsc`, ESLint and `next build` pass; the production server served the landing page and redirected an anonymous `/dashboard` request |
| Clerk -> Convex authentication with **real Clerk tokens** | **Verified** (API-driven) | Real session tokens (`aud: convex`, `name`, `email`) for two Clerk test users were accepted by a live Convex dev deployment; the full lend/borrow/approve/return flow and the negative authorization cases (unauthenticated, non-owner, non-lender, non-admin, double approve/return) behaved as designed. Test users and data were deleted afterwards |
| Live Convex HTTP endpoints | **Verified** | Probed on a real deployment: 401 for missing/wrong token and for the HMAC key used as API token, 200 for the real token, 400 for bad input |
| Live n8n -> live Convex call | **Verified** (claim path) | A signed webhook caused n8n to make an authenticated `claim` call to the real deployment with no failed execution |
| Convex deployment push, `convex/_generated` | **Verified** | `npx convex dev` pushed all functions and regenerated `_generated`; typecheck, lint and tests pass against it |
| Interactive Clerk sign-in/up in the browser (UI) | **Not exercised** | The login screens and the React UI were not clicked through; only the token/backend side was |
| Convex -> n8n delivery on a cloud deployment | **Not exercised** | Needs a public tunnel to n8n. Without one, dispatches fail visibly (`NETWORK_ERROR`, retried with backoff), which was observed live |
| Browser UI flows / end-to-end (Playwright) | **Not implemented** | The UI is verified by type-check, lint, build and a dev-server smoke test (landing 200, sign-in 200, anonymous dashboard redirect) |

Nothing above is claimed beyond what was run. The remaining manual steps are listed in [Local development](#local-development).

## Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4 | Server-rendered public page, client-side reactive app shell; `strict` plus `noUncheckedIndexedAccess` |
| UI | shadcn/ui-style primitives (Radix Dialog, class-variance-authority) | Accessible dialogs and focus handling without a heavy component library |
| Auth | Clerk (`@clerk/nextjs` 7) | Hosted sign-in/up and sessions; issues the JWT Convex verifies |
| Backend + DB | Convex | Transactional mutations with optimistic concurrency (what makes approval race-free), reactive queries, scheduler (outbox), HTTP actions (n8n endpoints), all in TypeScript |
| Automation | n8n (pinned `1.123.92`) | Visual, inspectable workflows with per-node retries, execution history and error workflows |
| Validation | Zod 4 | One schema file shared by browser forms and Convex mutations |
| Tests | Vitest 5 + `convex-test` | Runs Convex functions, schema, scheduler and HTTP routes in-process |

Not used, by design: Prisma/Postgres, Supabase, NextAuth, an Express/Nest server, cron jobs in place of n8n. Next.js has **no** business-logic API routes; the only server code in Next is Clerk's `proxy.ts`.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI]
  end
  subgraph Vercel/Node
    NX[Next.js App Router<br/>proxy.ts = Clerk route guard]
  end
  CL[Clerk]
  subgraph Convex
    FN[Queries & mutations<br/>RBAC + business rules]
    DB[(Tables)]
    OB[Outbox: automationEvents<br/>+ scheduled dispatch]
    HT[HTTP actions /n8n/*]
  end
  subgraph n8n
    WA[A: Request notification]
    WB[B: Overdue reminders<br/>daily schedule]
    WC[C: Error handler]
  end
  SMTP[Notification provider<br/>SMTP / Mailpit]

  UI -- pages --> NX
  UI -- sign in --> CL
  CL -- session JWT --> UI
  UI -- "Convex client + Clerk JWT" --> FN
  FN <--> DB
  FN --> OB
  OB -- "HMAC-signed webhook" --> WA
  WA -- "Bearer: claim / result" --> HT
  WB -- "Bearer: sweep / claim / result" --> HT
  WC -- "Bearer: error report" --> HT
  HT --> FN
  WA --> SMTP
  WB --> SMTP
```

### Request-notification flow (transactional outbox)

```mermaid
sequenceDiagram
  participant U as Borrower (browser)
  participant C as Convex
  participant N as n8n workflow A
  participant M as SMTP provider
  U->>C: requests.create (Clerk JWT)
  C->>C: validate, authorize, insert request<br/>+ insert automationEvent(pending)<br/>+ schedule dispatch (ONE transaction)
  C->>N: POST signed webhook (event -> processing)
  N->>N: verify HMAC over raw body, timestamp, schema
  N-->>C: 202 accepted (not "delivered")
  N->>C: POST /n8n/events/claim {eventId, deliveryId}
  C-->>N: {proceed:true} (lease; replays refused)
  N->>M: send email (3 tries)
  alt sent
    N->>C: POST /n8n/events/result {outcome: sent}
    C->>C: status = sent
  else failed
    N->>C: POST /n8n/events/result {outcome: failed, errorCode, retryable}
    C->>C: status = failed, schedule retry (backoff, max 5)
  end
```

### Overdue-reminder flow

```mermaid
sequenceDiagram
  participant N as n8n workflow B (daily 09:00)
  participant C as Convex
  participant M as SMTP provider
  N->>C: POST /n8n/overdue/run
  C->>C: active & past due -> overdue; create reminder events<br/>key = overdue-reminder:{loanId}:{YYYY-MM-DD}
  C-->>N: minimal reminder list (borrower name/email, tool, due date)
  loop each reminder
    N->>C: claim
    C-->>N: proceed (false if sent / loan returned)
    N->>M: send reminder
    N->>C: result sent | failed
  end
```

## Database schema

Defined in [convex/schema.ts](convex/schema.ts). Every index exists to serve a specific query; no list is built by fetching a table and filtering in memory.

| Table | Important fields | Indexes (purpose) |
| --- | --- | --- |
| `users` | `clerkId`, `name?`, `email?`, `role` (`admin`\|`user`), `isTrustedLender` | `by_clerkId` - resolve the caller from the verified JWT subject on every call; uniqueness of identity |
| `tools` | `ownerId -> users`, `name`, `category`, `condition`, `description`, `status` (`available`\|`unavailable`\|`removed`) | `by_ownerId` - My Listings, dashboard; `by_status_and_category` - public landing list (status only) and category-filtered browsing |
| `borrowRequests` | `toolId`, `borrowerId`, `lenderId`, `startDate`, `endDate`, `message?`, `status` (`pending`\|`approved`\|`declined`\|`cancelled`) | `by_borrowerId_and_status` - My Requests, pending cap, dashboard; `by_lenderId_and_status` - Incoming Requests; `by_toolId_and_status` - cascade-cancel when a tool is removed |
| `loans` | `requestId`, `toolId`, `borrowerId`, `lenderId`, dates, `status` (`active`\|`returned`\|`overdue`), `returnedAt?` | `by_requestId` - one loan per request; `by_toolId_and_status` - overlap check on approval (its read range is what serialises concurrent approvals); `by_borrowerId_and_status` / `by_lenderId_and_status` - My Loans, dashboard; `by_status_and_endDate` - overdue sweep and admin filter |
| `automationEvents` | `eventKey`, `eventType`, `correlationId`, `status` (`pending`\|`processing`\|`sent`\|`failed`\|`skipped`), `attempts`, `claimedAt`, `claimedDeliveryId`, `errorCode`, `workflowName?`, `executionId?`, optional `loanId`/`requestId`/`recipientUserId` | `by_eventKey` - idempotency (one event per deterministic key); `by_status` - admin monitoring; `by_recipientUserId` - "recent notifications" on the dashboard |
| `rateLimits` | `key`, `windowStart`, `count` | `by_key` - fixed-window limiter for n8n-facing endpoints |

Added beyond the brief (documented deviations): `correlationId`, `claimedAt`, `claimedDeliveryId`, `workflowName`, `executionId` and the `skipped` status on `automationEvents`; the `rateLimits` table. Events store no secrets, signatures, e-mail addresses or message text.

## Authentication and authorization

**Identity.** Clerk issues a JWT (`aud: convex`) that `ConvexProviderWithClerk` attaches to every Convex call. [convex/auth.config.ts](convex/auth.config.ts) tells Convex to trust Clerk's issuer. Inside any function, `ctx.auth.getUserIdentity()` returns the *verified* subject; [convex/lib/auth.ts](convex/lib/auth.ts) maps it to the `users` row. After sign-in the shell calls `users.store`, which takes **no arguments**: name/email come from the token and new users are always `role: "user"`.

**RBAC.** Roles live only in `users.role`. There is no public function that changes a role; admins are created with an *internal* function that only the Convex dashboard/CLI can call:

```bash
npx convex run users:setRole '{"clerkId":"user_XXXX","role":"admin"}'   # the person must have signed in once
```

`isTrustedLender` can only be changed by `users.setTrustedLender`, which calls `requireAdmin`.

**Helpers** ([convex/lib/auth.ts](convex/lib/auth.ts), [convex/lib/permissions.ts](convex/lib/permissions.ts)): `getAuthenticatedUser`, `requireAuthenticatedUser`, `requireAdmin`, `requireToolOwner`, `requireBorrowerOrLender`, `requireLender`, `requireBorrower`, `requireLoanParticipant`. Every sensitive function follows: authenticate -> resolve user -> check role -> validate input -> verify ownership/participation -> act -> return only needed fields.

**IDOR.** The browser only ever sends document ids. Private records (requests, loans) answer **NOT_FOUND** to non-participants, so guessing ids reveals nothing, not even existence. Acting on someone else's tool returns FORBIDDEN, and tests assert both. Frontend route guards and hidden buttons are conveniences only.

| Capability | user | admin |
| --- | --- | --- |
| Create / edit / remove own listings | yes | yes |
| Remove *any* listing | no | yes |
| Request, cancel own pending requests | yes | yes |
| Approve / decline requests on own tools | yes | only for own tools |
| Mark own lent loans returned | yes | only for own tools |
| View all loans, member list, automation events | no | yes |
| Mark a lender trusted | no | yes |

## Business rules

- **Request lifecycle:** `pending -> approved | declined | cancelled`. Everything else is rejected with `INVALID_STATE` ([convex/lib/stateMachine.ts](convex/lib/stateMachine.ts)); no mutation accepts a status from the client.
- **Loan lifecycle:** `active -> returned`, `active -> overdue`, `overdue -> returned`. Only the *lender* confirms a return. Loans are created only by `requests.approve`.
- **Dates** are UTC-midnight timestamps. Start must be today or later and before end; max 30 days; max 365 days ahead. Intervals are half-open, so back-to-back loans (end = next start) are allowed. A loan is *overdue* once its whole due day has passed.
- **Overlap rule** `existingStart < requestedEnd AND existingEnd > requestedStart` is applied against open (`active`/`overdue`) loans of the same tool, both when a request is created (early feedback) and, authoritatively, on approval. Returned loans free their dates.
- **Concurrency.** Convex mutations are serializable transactions with optimistic concurrency control. The approval reads the tool's open-loan index range; if a concurrent approval inserts an overlapping loan first, one transaction is retried, re-reads, and fails the overlap check. A unique `by_requestId` check additionally prevents two loans per request. `convex-test` runs mutations in one process, so the concurrency tests prove the *logic* under interleaved calls, not the production OCC scheduler itself; that guarantee comes from Convex's documented semantics.
- **Request spam:** max 20 pending requests per borrower; duplicate overlapping pending requests for the same tool are rejected.
- **Tool removal** is a soft delete. Owners cannot remove a tool that is currently out on loan; admins can (moderation). Pending requests for a removed tool are cancelled (without e-mail, since nobody acted).
- **Tool status vs. availability.** `tools.status` is the *owner's listing switch*. Whether a tool is free on given dates is derived from loans (the overlap rule), so a tool with a loan next month can still be requested for other dates. Returning a loan closes the loan (`returnedAt`), verifies the loan/request/tool trio is consistent, touches the tool, and leaves the request `approved` as terminal history.

## Automation (n8n)

Workflow exports live in [n8n/workflows](n8n/workflows). They are **generated** by `npm run n8n:build` from the readable Code-node sources in [n8n/code](n8n/code) (so the logic is lintable, reviewable and unit-tested); the JSON is committed. IDs are stable, so re-importing updates in place.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| **A. Request notifications** (`request-notification.json`) | Webhook `POST /webhook/lendloop/request-events` | Verify HMAC -> respond 202 -> claim -> build email -> send (3 tries) -> report `sent` / `failed` |
| **B. Overdue reminders** (`overdue-reminders.json`) | Schedule, daily 09:00 (`GENERIC_TIMEZONE`) | Convex sweep -> per reminder: claim -> email -> report |
| **C. Error handler** (`error-handler.json`) | Error Trigger (set as `errorWorkflow` of A and B) | Reduce failure to workflow name, execution id, category -> `POST /n8n/errors` |

### Event types and routing

| Event | Recipient (decided by Convex, **re-checked by n8n**) | Message |
| --- | --- | --- |
| `request.created` | lender | New request for *tool*, dates, note, link to Incoming Requests |
| `request.approved` / `request.declined` | borrower | Outcome, dates, next step |
| `request.cancelled` | lender | Borrower cancelled, no action needed |
| `loan.overdue_reminder` | borrower | Tool, due date, days overdue |

### Convex -> n8n payload (schema v1)

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

Data minimisation: one recipient, no Convex/Clerk ids, no profiles, no tokens; the borrower's note is included only for the lender on `request.created`.

### Signing (Convex -> n8n)

```
X-LendLoop-Timestamp:   Unix seconds
X-LendLoop-Delivery-Id: unique per attempt
X-LendLoop-Signature:   v1=<hex HMAC-SHA256>
signature = HMAC_SHA256(CONVEX_N8N_WEBHOOK_SECRET, "v1:" + timestamp + ":" + deliveryId + ":" + rawBody)
```

- **Raw bytes, not re-serialised JSON.** The Webhook node has *Raw Body* enabled and the Code node hashes `getBinaryDataBuffer()`. Re-stringifying parsed JSON does not reproduce the signed bytes; an interoperability test signs a body with unusual whitespace and non-ASCII characters and confirms n8n verifies it.
- **Constant-time comparison** (`crypto.timingSafeEqual` in n8n; SHA-256-digest XOR loop in Convex for bearer checks). Malformed signatures (wrong prefix, case, length) are rejected before any HMAC work.
- **Freshness:** `|now - timestamp| <= 300 s`, otherwise 401 `stale_request` (also rejects future-dated).
- **Replay protection is layered, and honestly scoped:** (1) the 5-minute window bounds a captured request's lifetime; (2) Convex's `/n8n/events/claim` accepts each signed `deliveryId` **once** and grants a 10-minute lease per event, so a replayed or duplicated delivery cannot trigger a second send. I first tried a replay cache in n8n workflow static data; testing showed it does not persist across webhook executions in this setup, so it was removed rather than left as false assurance.
- **Payload validation** in n8n: schema version, id formats, UUID, email, ISO dates, lengths, `http(s)` action URL, body `deliveryId` equals the signed header, recipient role and status match the event type.

### n8n -> Convex

`POST {CONVEX_SITE_URL}/n8n/...` with `Authorization: Bearer N8N_CONVEX_API_SECRET` (a *different* secret from the HMAC key; a test confirms the HMAC key is not accepted as an API credential). Order of checks: configured? -> bearer (constant-time) -> body size (32 KB) -> rate limit (600/min, fixed window) -> JSON -> strict Zod schema -> run. Responses are terse, errors never include stack traces or payloads, and nothing is processed before authentication.

| Endpoint | Purpose |
| --- | --- |
| `/n8n/events/claim` | "May I send?" Refuses sent/skipped events, replayed deliveries, concurrent claims, never-dispatched events, and reminders whose loan was returned |
| `/n8n/events/result` | Idempotent write-back: `sent` is final and never downgraded; repeated reports are no-ops; retryable failures reschedule |
| `/n8n/overdue/run` | Marks past-due `active` loans `overdue`, creates today's reminder events, returns only what the e-mail needs |
| `/n8n/errors` | Records a workflow failure (name, execution id, coarse category only). Free-text messages are rejected by the schema |

### Reliability model

- **Transactional outbox.** `requests.create/approve/decline/cancel` insert the `automationEvents` row *and* schedule the dispatcher in the same transaction as the business change. A rollback leaves neither; a commit guarantees delivery will be attempted even if n8n is down.
- **States:** `pending -> processing -> sent | failed` (plus `skipped` for returned loans). HTTP 2xx from n8n only means *accepted*: the event stays `processing` until n8n reports the real send result. No report within 5 minutes -> `failed: ACK_TIMEOUT`.
- **Retries.** Convex: up to 5 attempts, exponential backoff (30 s, 60 s, 2 min, ...), retrying network errors, timeouts, 408/425/429/5xx; other 4xx and bad configuration are permanent. n8n: HTTP and e-mail nodes retry 3 times; a send failure is classified (`SMTP_TIMEOUT`, `SMTP_AUTH`, ...) and reported with a `retryable` hint. Reminders are re-listed the same day until `sent` or 5 attempts. Nothing retries forever; the error workflow does not have an error workflow.
- **Idempotency keys:** `request.<type>:<requestId>`, `overdue-reminder:<loanId>:<YYYY-MM-DD>`, `workflow-error:<workflow>:<executionId>`; enforced by `by_eventKey` get-or-create inside Convex, not in n8n.
- **Correlation:** each event has a `correlationId` (also sent as `X-LendLoop-Correlation-Id`) shown in the admin Automation tab and carried in the payload.
- **Visibility.** Failures never vanish: admins see all events (filter *Failed*, with attempts, error code, workflow/execution id, correlation id) at `/admin` -> Automation, and members see their own recent notifications on the dashboard.

### Operating it: inspect and recover

1. **App-level:** `/admin` -> Automation -> *Failed*. After fixing the cause (credentials, SMTP, n8n down), press **Retry** (resets attempts and re-dispatches). Reminders recover on the next sweep.
2. **n8n-level:** Executions list shows failed runs (failed executions are always saved, pruned after 14 days). Open a failed execution to see the failing node and **Retry** it from the editor. Execution ids in the admin view match n8n's.
3. **Reconcile:** because Convex is authoritative and `claim` refuses already-sent events, re-running an n8n execution can never double-send.
4. **Do not activate the error workflow:** n8n runs it automatically when it is referenced by other workflows (activating a trigger-less workflow logs errors; this was observed in testing).

### Trade-offs

At-least-once delivery with a Convex-side duplicate guard rather than exactly-once; the one residual window is "n8n sent the email, then crashed before reporting" which, after the 5-minute timeout and retry, can produce one duplicate email. n8n reads secrets via `$env`, so anyone who can *edit workflows* can read them (acceptable locally; see production notes).

## Local development

### 0. Prerequisites

Node.js >= 20.9 (developed on 24), npm, Docker with Compose, accounts at [Clerk](https://clerk.com) and [Convex](https://convex.dev) (both have free tiers).

```bash
npm install
cp .env.example .env.local     # Next.js + Convex CLI values (section 1 of the file)
cp .env.example .env           # Docker Compose values (section 3); keep only what you need
```

### 1. Convex

```bash
npx convex dev        # logs in, creates a dev deployment, regenerates convex/_generated, writes CONVEX_DEPLOYMENT + NEXT_PUBLIC_CONVEX_URL to .env.local
```

Leave it running. It prints two URLs: the **client URL** (`https://<name>.convex.cloud`, goes in `NEXT_PUBLIC_CONVEX_URL`) and the **HTTP actions URL** (`https://<name>.convex.site`, this is `CONVEX_SITE_URL` for n8n).

### 2. Clerk

1. Create an application; copy the publishable and secret keys into `.env.local`.
2. In the Clerk dashboard open **Integrations -> Convex** and activate it. This creates the `convex` JWT template (`aud: "convex"`). Check the template includes the `name` and `email` claims: without an email, members have no address to notify (their events are recorded as `failed: NO_RECIPIENT_EMAIL`).
3. Copy the **Frontend API URL** (e.g. `https://verb-noun-00.clerk.accounts.dev`) into Convex as `CLERK_JWT_ISSUER_DOMAIN` (next step).

### 3. Convex environment variables (server-side only)

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://verb-noun-00.clerk.accounts.dev"
npx convex env set CONVEX_N8N_WEBHOOK_SECRET "$(openssl rand -hex 32)"   # note it: n8n needs the same value
npx convex env set N8N_CONVEX_API_SECRET     "$(openssl rand -hex 32)"   # note it: n8n needs the same value
npx convex env set APP_URL "http://localhost:3000"
npx convex env set N8N_WEBHOOK_URL "http://localhost:5678/webhook/lendloop/request-events"
```

`npx convex env list` shows what is set. Re-run `npx convex dev` after changing `convex/auth.config.ts`.

> **Reachability.** A Convex *cloud* dev deployment cannot call `localhost`. Expose n8n with a tunnel (e.g. `cloudflared tunnel --url http://localhost:5678` or ngrok) and set `N8N_WEBHOOK_URL` to `https://<tunnel-host>/webhook/lendloop/request-events` (and `N8N_PUBLIC_URL`/`WEBHOOK_URL` in `.env`). Plain `http` is accepted only for localhost; every other URL must be `https` (enforced in [convex/lib/env.ts](convex/lib/env.ts)).

### 4. n8n + Mailpit (Docker)

Edit `.env` (the Compose file refuses to start without these):

```
N8N_ENCRYPTION_KEY=<openssl rand -hex 32>         # back this up; changing it orphans stored credentials
CONVEX_SITE_URL=https://<name>.convex.site
CONVEX_N8N_WEBHOOK_SECRET=<same value as in Convex>
N8N_CONVEX_API_SECRET=<same value as in Convex>
```

```bash
npm run n8n:up          # docker compose up -d     -> n8n http://localhost:5678, Mailpit inbox http://localhost:8025
docker compose logs -f n8n
npm run n8n:down        # stop (data kept in the n8n_data volume);  docker compose down -v  also wipes it
```

Pinned images: `docker.n8n.io/n8nio/n8n:1.123.92`, `axllent/mailpit:v1.27`. Ports bind to `127.0.0.1` only. The container sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto` and `N8N_RUNNERS_ENABLED=false` because the workflows read the two secrets via `$env` and verify HMACs with Node's `crypto`.

### 5. Import the workflows and create the SMTP credential

Open http://localhost:5678, create the owner account, then either use the UI (*Workflows -> Import from file*) or the CLI:

```bash
docker compose exec n8n n8n import:workflow --input=/workflows/error-handler.json
docker compose exec n8n n8n import:workflow --input=/workflows/request-notification.json
docker compose exec n8n n8n import:workflow --input=/workflows/overdue-reminders.json
```

Create one **SMTP** credential named exactly `LendLoop SMTP` (UI: *Credentials -> Add -> SMTP*) and select it on the two *Send email* nodes if n8n doesn't pick it up. For the bundled Mailpit: host `mailpit`, port `1025`, no user/password, SSL off. For real e-mail use your provider's SMTP settings. Credentials are stored encrypted in n8n; the exported JSON contains only the credential *name*.

Then **activate** *Request notifications* and *Overdue reminders* (toggle top-right). Do **not** activate *Error handler*; it is attached automatically through each workflow's *Settings -> Error workflow* (already set by the import).

### 6. Run the app, make yourself admin

```bash
npm run dev             # http://localhost:3000 (keep `npx convex dev` running)
```

Sign up, then grant yourself admin (the admin link and `/admin` appear after refresh):

```bash
npx convex run users:setRole '{"clerkId":"<your Clerk user id, user_...>","role":"admin"}'
```

### 7. Try the automation

1. Sign in as user A, add a tool; sign in as user B (another browser profile) and request it. A gets an e-mail in Mailpit (http://localhost:8025) within seconds; check `/admin -> Automation` for the event moving `processing -> sent`.
2. Approve/decline as A: B gets the outcome e-mail.
3. Overdue: the workflow runs daily at 09:00. To test now, open workflow B in n8n and press *Execute workflow* (sweeps only loans past their due day; to see one quickly, create a request for today -> tomorrow and run the sweep two days later, or temporarily edit a loan's `endDate` in the Convex dashboard).

## Environment variables

See [.env.example](.env.example) for the annotated template.

| Variable | Where it is set | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` (browser-safe) | Clerk frontend key |
| `CLERK_SECRET_KEY` | `.env.local` (**server secret**) | Clerk backend key used by `proxy.ts` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `..._SIGN_UP_URL`, `..._FALLBACK_REDIRECT_URL` | `.env.local` | Clerk routing |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` (browser-safe) | Convex client endpoint |
| `CONVEX_DEPLOYMENT` | `.env.local` (written by the CLI) | Which deployment the CLI targets |
| `CLERK_JWT_ISSUER_DOMAIN` | **Convex env** | Issuer Convex trusts for JWTs |
| `N8N_WEBHOOK_URL` | **Convex env** | Where Convex posts signed events (https, or http for localhost) |
| `CONVEX_N8N_WEBHOOK_SECRET` | **Convex env** and Docker `.env` | HMAC key, Convex -> n8n (>= 32 chars) |
| `N8N_CONVEX_API_SECRET` | **Convex env** and Docker `.env` | Bearer secret, n8n -> Convex (>= 32 chars, different from the above) |
| `APP_URL` | **Convex env** | Links inside notification e-mails |
| `CONVEX_SITE_URL` | Docker `.env` | `https://<name>.convex.site`, base URL of the Convex HTTP actions |
| `N8N_ENCRYPTION_KEY` | Docker `.env` | Encrypts n8n's stored credentials |
| `GENERIC_TIMEZONE`, `LENDLOOP_FROM_EMAIL`, `N8N_PUBLIC_URL` | Docker `.env` (optional) | Schedule timezone, sender, n8n public URL |

Server secrets are never `NEXT_PUBLIC_*`, never in exported workflows, and are validated where they are used (missing/short secrets make the endpoints or dispatcher fail closed with a server-side log naming the variable, never its value).

## Testing

```bash
npm run typecheck   # tsc for the app and for convex/
npm run lint        # ESLint (next/core-web-vitals + typescript-eslint, no-explicit-any, ban-ts-comment)
npm test            # Vitest: unit + Convex integration + n8n workflow tests
npm run build       # needs the Clerk/Convex placeholder env vars from .env.example
```

| Suite | Covers |
| --- | --- |
| `tests/convex/authorization.test.ts` | unauthenticated rejection, default role, non-owner edit/remove, IDOR on requests and loans (NOT_FOUND), admin-only queries/mutations, trusted-lender gating, public query returns *only* name + category |
| `tests/convex/business-rules.test.ts` | own-tool borrowing, invalid dates, overlap (incl. touching ranges, freed after return, interleaved approvals), declined/cancelled cannot be approved, double return, loans only from approved requests, overdue presentation, dashboard scoping |
| `tests/convex/automation.test.ts` | outbox, signed dispatch contents (verified with the verifier, minimised), retries/backoff/permanent errors, ack timeout, config failure, endpoint auth (401/503/413/400), rate limit, claim lease and replay refusal, idempotent write-back, overdue sweep (no returned loans, no duplicate records, next-day key), workflow-error recording, admin retry |
| `tests/n8n/workflows.test.ts` | runs the *exported* Code nodes: signature interoperability with the Convex signer, tamper/stale/malformed/wrong-secret rejection, payload and recipient validation, e-mail builders (HTML/header-injection escaping), failure classification, error sanitisation, and no-secrets scans of the JSON |
| `tests/lib/units.test.ts` | overlap rule table, date range rules, Zod schemas, state machines, error contract, signing, env validation |

**Not covered:** browser/E2E tests (Playwright needs live Clerk + Convex; none were available) and any test hitting a real Convex deployment or real Clerk. React components are covered by type-check, lint and the production build only.

## Security and privacy decisions

- **Public data minimisation.** The landing page uses a dedicated `tools.listPublic` query whose `returns` validator is an allow-list `{name, category}`; Convex rejects any extra field, so a future change cannot silently leak owners, descriptions or ids. A test checks owner names, contact text in descriptions and ids are absent.
- **Backend authorization everywhere.** Next.js `proxy.ts` only redirects anonymous visitors. Every Convex function re-authenticates and re-authorizes; admin endpoints use `requireAdmin`; internal functions (`setRole`, dispatch, n8n write-backs) are unreachable from clients.
- **IDOR prevention.** Actor identity comes from the verified token; ids from the client are only looked up and then checked for ownership/participation; private records return NOT_FOUND to outsiders.
- **Other members only see** a display name and a "trusted lender" flag. E-mail and Clerk ids never leave `users.current` (own record), the admin member list, or the single signed payload to n8n for the intended recipient.
- **Secrets.** In env vars only (Convex dashboard / `.env` files, git-ignored); separate secrets per direction; ≥ 32 chars enforced; exported workflows contain `$env` references and credential names, verified by a test scan.
- **HMAC + replay + idempotency:** see [Automation](#automation-n8n).
- **Input validation.** Convex argument validators + shared Zod schemas (length limits, enum categories, whole-day timestamps, control-character rejection), strict Zod schemas on every HTTP body (unknown keys rejected), body size cap.
- **Safe errors.** Business errors are `ConvexError {code, message}` with user-safe text; unexpected errors surface in the UI as a generic message; Convex logs keep diagnostics (variable names, event correlation ids, error class), never payloads, secrets or e-mail addresses. HTTP endpoints return `{"error": "<code>"}` only.
- **Output encoding.** React escapes UI output; e-mail HTML escapes all user text and strips newlines from subjects (header-injection test).
- **Browser hardening.** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader` off.
- **Data retention.** `automationEvents` hold ids, statuses and coarse error codes only (no e-mail addresses, message text or signatures), but they currently grow without bound; see below. n8n prunes execution data after 14 days; failed executions may contain the payload (recipient e-mail, note), so treat n8n's database as personal data.

## What I would change before production

- **Hosting & networking:** deploy Next.js on a managed platform (Vercel or similar) with a custom domain; run n8n in a hardened environment (queue mode + Postgres + Redis for scale, or n8n Cloud) behind HTTPS and not reachable from the internet except the single webhook path; restrict the editor to SSO/VPN.
- **Secrets:** a managed secret store with rotation (and n8n external secrets) instead of `$env`; per-environment secrets; support two active HMAC keys during rotation (accept `v1` signatures from old and new key). Rotate on staff changes.
- **Rate limiting & abuse:** enforce per-IP limits and WAF rules at the edge for `/n8n/*`; add per-user write limits (request creation is only capped by the 20-pending rule today); consider IP allow-listing n8n's egress for the n8n -> Convex endpoints.
- **Sender-side hardening:** sign n8n -> Convex calls with HMAC (timestamp + body) as well as the bearer token, so a leaked token alone is not enough.
- **Monitoring & alerting:** alert on `failed` events / `ACK_TIMEOUT` rates, n8n error-workflow records, and a stuck-event watchdog; ship Convex logs and n8n execution logs to a log platform; add uptime checks on n8n `/healthz` and the Convex site URL; add error tracking (e.g. Sentry) to the frontend.
- **Backups & recovery:** Convex backups/snapshot exports on a schedule and a rehearsed restore; back up the n8n database *and* `N8N_ENCRYPTION_KEY` separately; keep workflow JSON in git (done) and deploy it via CI (`n8n import:workflow`).
- **Data retention:** a scheduled cleanup for `automationEvents` and `rateLimits`, retention windows and deletion on account removal; a privacy notice covering the e-mail processor.
- **Workflow recovery:** a runbook and an on-call alert for the error workflow; replay tooling for dead events beyond the admin Retry button.
- **Operational access control:** least-privilege n8n users, audit logging for admin actions in Convex (role changes, listing removals are currently not audit-logged), two-person approval to grant admin.
- **Observability:** distributed tracing keyed on `correlationId`, dashboards for delivery latency and retry counts.
- **Product gaps:** account/profile sync via Clerk webhooks (names/emails are refreshed on each sign-in only), pagination cursors in URLs, image uploads, in-app notification centre, E2E suite in CI.
- **Dependencies:** `npm audit` reports a moderate `minimatch` advisory in the ESLint toolchain (dev-only, not shipped); upgrade when the Next ESLint plugins allow it.

## Known limitations

- The React UI has not been clicked through in a browser, and Convex -> n8n delivery was not tested over a public tunnel (see [Status](#status-what-is-verified-and-what-is-not)).
- No E2E browser tests; UI behaviour is verified by compile/lint/build and by testing the backend functions the UI calls.
- Email/name rely on the Clerk token claims; members without an email are not notified (the failure is visible to admins).
- Overdue detection is event-driven by the daily sweep plus a query-time presentation rule; if n8n is down, loans stay `active` in storage but are *shown* as overdue.
- `tools.status` is not changed automatically by loans (availability is derived from dates); there is no per-tool calendar view.
- Concurrency tests exercise logic through `convex-test`; the production OCC retry path itself is Convex's, not tested here.
- n8n replay detection of identical deliveries is enforced in Convex (not in n8n), so a replay still reaches n8n's webhook and is only stopped at the claim step.
