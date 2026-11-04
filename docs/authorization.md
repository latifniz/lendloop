# Authorization matrix

Every rule here is enforced inside Convex functions. Next.js `proxy.ts` only redirects signed-out visitors; hidden buttons are a convenience. Identity always comes from the verified Clerk token (`ctx.auth.getUserIdentity()`), never from an argument.

Helpers live in [convex/lib/auth.ts](../convex/lib/auth.ts) and [convex/lib/permissions.ts](../convex/lib/permissions.ts). Every function below authenticates, resolves the caller's `users` row, checks role or ownership, validates input, then acts.

## Public-facing functions

| Function | Who can call | Check | Notes |
| --- | --- | --- | --- |
| `tools.listPublic` | anyone | none | `returns` validator is an allow-list `{name, category}`: Convex rejects any extra field |
| `users.store` | signed-in | token present | takes **no arguments**; name/email come from the token; new users are always `role: "user"` |
| `users.current` | signed-in | own record | |
| `tools.listBrowse`, `tools.listMine` | signed-in | own scope | other members' emails never leave the backend |
| `tools.getForEdit`, `tools.update` | signed-in | `requireToolOwner` | non-owner gets `FORBIDDEN` |
| `tools.create` | signed-in | caller becomes owner | shared Zod schema validates input |
| `tools.remove` | owner, or admin | owner: no open loan; non-owner: `requireAdmin` | cancels pending requests; admin removals are audit-logged |
| `requests.create` | signed-in | not your own tool; dates valid; overlap and pending-cap rules | writes the notification event in the same transaction |
| `requests.approve`, `requests.decline` | the tool's lender | `requireLender` | approval re-checks overlap against open loans |
| `requests.cancel` | the borrower | `requireBorrower` | only while `pending` |
| `requests.get`, `requests.listMine`, `requests.listIncoming` | participants | `requireBorrowerOrLender` | outsiders get `NOT_FOUND`, not `FORBIDDEN`, so ids reveal nothing |
| `loans.get`, `loans.listMine` | participants | `requireLoanParticipant` | same `NOT_FOUND` rule |
| `loans.markReturned` | the lender | `requireLender` | the borrower cannot confirm their own return |
| `dashboard.*` | signed-in | own scope | |

## Admin-only functions (`requireAdmin`)

`tools.listForAdmin`, `loans.listForAdmin`, `users.listForAdmin`, `users.setTrustedLender`, `automation.listRecent`, `automation.retryFailed`, `audit.listRecent`, and `tools.remove` on someone else's listing.

## Not reachable from a browser

- **Internal functions** (`users.setRole`, the dispatcher, claim/result/overdue/error handlers, the stuck-event watchdog, rate limiting). Only the Convex dashboard/CLI or other Convex functions can call them. Admins are created with:
  ```bash
  npx convex run users:setRole '{"clerkId":"user_XXXX","role":"admin"}'
  ```
- **HTTP actions** under `/n8n/*` (claim, result, overdue run, errors). They require `Authorization: Bearer N8N_CONVEX_API_SECRET`, and an HMAC over the route and body when `N8N_CONVEX_SIGNING_SECRET` is set. Order of checks: configured → bearer (constant-time) → body size → signature → rate limit → JSON → strict Zod schema.

## What each role can do

| Capability | user | admin |
| --- | --- | --- |
| Create / edit / remove own listings | yes | yes |
| Remove any listing | no | yes (audited) |
| Request, and cancel own pending requests | yes | yes |
| Approve / decline requests on own tools | yes | own tools only |
| Mark own lent loans returned | yes | own tools only |
| View all loans, member list, automation events, audit log | no | yes |
| Mark a lender "Trusted" | no | yes (audited) |
| Change roles | no (CLI only) | no (CLI only; audited) |

Tests: [tests/convex/authorization.test.ts](../tests/convex/authorization.test.ts) covers unauthenticated rejection, non-owner edits, IDOR on requests and loans, admin-only access and the public query's allow-list; [tests/convex/audit.test.ts](../tests/convex/audit.test.ts) covers the audit log.
