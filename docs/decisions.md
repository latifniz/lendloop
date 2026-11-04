# Design decisions

Short records of the choices that shaped the system, including two that changed after testing.

## 1. All logic and authorization in Convex; no Next.js API routes
**Context.** Authorization checks scattered across a UI and several API layers are easy to miss.
**Decision.** Every rule lives in Convex functions. Next.js only renders and redirects signed-out visitors.
**Consequence.** One place to audit ([authorization matrix](authorization.md)). Hidden buttons and route guards are conveniences, never the control.

## 2. Transactional outbox instead of calling n8n from the mutation
**Context.** A request must never be saved without its notification, or notified without being saved. Calling n8n inside the mutation couples availability and can't be rolled back.
**Decision.** The mutation writes an `automationEvents` row and schedules a dispatcher in the same transaction.
**Consequence.** Delivery is attempted whenever the business change commits, even if n8n is down, and is retried with backoff.

## 3. "Accepted" is not "delivered"
**Context.** n8n answers the webhook immediately (202) before sending the email.
**Decision.** The event stays `processing` until n8n reports `sent` or `failed` through `/n8n/events/result`; no report in 5 minutes becomes `ACK_TIMEOUT`.
**Consequence.** Status in the admin view reflects what actually happened, and a crashed execution can't look successful.

## 4. Replay protection in Convex, not in n8n *(changed after testing)*
**Context.** The first design stored seen delivery ids in n8n workflow static data.
**Finding.** Against a real n8n container, static data did not persist across webhook executions in this setup, so a replayed request passed.
**Decision.** Removed it rather than leave false assurance. Convex's `claim` endpoint accepts each signed `deliveryId` once and grants a lease per event.
**Consequence.** A replay still reaches n8n's webhook and is stopped at the claim step, before any email is sent. The README and integration doc say so.

## 5. Sign the raw body bytes
**Context.** Re-serialising parsed JSON does not reproduce the bytes that were signed.
**Decision.** The Webhook node keeps the raw body; the Code node hashes it. The v1 scheme binds timestamp, delivery id and body.
**Consequence.** Verified with an interoperability test (odd whitespace, non-ASCII) and against the real n8n image.

## 6. Separate secrets per direction, plus an optional second factor
**Context.** One shared secret means a leak in either direction compromises both.
**Decision.** An HMAC key for Convex → n8n, a bearer secret for n8n → Convex, and an optional third key that adds an HMAC (over route and body) to the bearer calls. A test confirms the HMAC key is refused as a bearer token.
**Consequence.** A leaked bearer token alone is not enough once the optional key is on. It is optional so existing deployments keep working; production should require it.

## 7. The public query's `returns` validator is an allow-list
**Context.** A future edit could accidentally return owner details to signed-out visitors.
**Decision.** `tools.listPublic` declares `returns: { name, category }`. Convex rejects any extra field. A browser test checks the real payload.
**Consequence.** Data minimization is enforced by the platform, not by remembering to strip fields.

## 8. Outsiders get `NOT_FOUND`, not `FORBIDDEN`, for private records
**Decision.** Requests and loans answer `NOT_FOUND` to non-participants. Acting on someone else's *tool* returns `FORBIDDEN`.
**Consequence.** Guessing ids reveals nothing, not even that a record exists.

## 9. Roles can only change from the Convex CLI/dashboard
**Decision.** No public function changes `role`; admins are created with the internal `users.setRole`, and the change is audit-logged.
**Consequence.** There is no privilege-escalation path through the app. The cost: granting admin needs operator access.

## 10. Availability is derived from loans
**Decision.** `tools.status` is only the owner's listing switch. Whether a tool is free on given dates comes from the overlap rule against open loans.
**Consequence.** A tool with a loan next month can still be requested for other dates, and there is no status field to drift out of sync.

## 11. Soft-delete listings
**Decision.** Removing a listing sets `status: "removed"`, cancels its pending requests (without email) and keeps loan history.
**Consequence.** Loans and audit entries never point at a missing document.

## 12. Newest-first lists need an index that ends in time *(found by a test)*
**Finding.** The public list and unfiltered Browse used the `(status, category)` index, which sorts by category before time, so with the 24-item cap a newer tool could be hidden.
**Decision.** A plain `by_status` index for lists without a category filter.
**Consequence.** Newest first is true, and a regression test covers it.

## 13. Zod `jitless` mode to keep the CSP free of `'unsafe-eval'`
**Context.** Zod probes `new Function()` for a fast path, which a strict Content-Security-Policy blocks.
**Decision.** Skip the probe; the schemas are tiny.
**Consequence.** The production policy has no `'unsafe-eval'`, and the browser console stays clean.

## 14. Workflow JSON is generated from readable sources
**Decision.** Code-node JavaScript lives in `n8n/code/*.js`; a script assembles the exported JSON, and CI fails if the committed JSON is stale.
**Consequence.** The logic is lintable, reviewable and unit-tested instead of escaped inside JSON.

## 15. Clerk development instance on `*.vercel.app`
**Context.** Clerk production instances do not allow `*.vercel.app`.
**Decision.** Ship on a development instance for the take-home and document the production path (custom domain).
**Consequence.** A "Development mode" banner and Cloudflare bot checks for scripted sign-up; browser tests use Clerk's testing tokens.
