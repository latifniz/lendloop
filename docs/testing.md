# Testing

Three layers, each aimed at what it can actually prove.

| Layer | Tool | Files | Tests | What it proves |
| --- | --- | --- | --- | --- |
| Backend logic | Vitest + `convex-test` (in-memory Convex) | `tests/convex/*` | 123 | Authorization, IDOR, business rules, the outbox, retries, the watchdog, the audit log, query scoping and the HTTP endpoints |
| n8n workflows and shared code | Vitest, running the **exported** Code nodes | `tests/n8n`, `tests/lib` | 76 | Signature verification and signing, payload validation, email builders, failure classification, the no-secrets scan; overlap rule, date rules, schemas, state machines |
| UI components | Vitest + Testing Library (jsdom) | `tests/components/*` | 48 | Form validation messages, the borrow dialog's date rules and error handling, which actions each role sees on a request or loan, confirmation dialogs |
| Browser | Playwright against a running app | `tests/e2e/*` | 31 | Real sign-up with an emailed code, the full lending story across three members, the admin area, the public tool list's fields, CSP headers and violations, redirects, the mobile drawer |

`npm test` runs the first three (247 tests). `npm run e2e` runs the browser suite.

## Running

```bash
npm run typecheck && npm run lint && npm test          # fast, no network
npm run e2e:install && npm run e2e                      # needs a running app + a Clerk dev instance
```

Browser tests need `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (a Clerk **development** instance, for testing tokens) and `E2E_BASE_URL` (default `http://localhost:3000`).

- **Admin tests** are opt-in with `E2E_ADMIN_BOOTSTRAP=convex-cli`: roles cannot change from the browser, so the suite promotes a member through the Convex CLI's internal `users:setRole` against the deployment in `.env.local`. Use a dev deployment.
- **n8n check** runs when `E2E_N8N_URL` is set: health endpoint plus a forged-webhook refusal.
- The suite removes its listings and Clerk users afterwards. Requests and loans remain in the target Convex deployment, so prefer a dev deployment over production.
- **CI.** The `E2E (browser)` workflow runs on every pull request: it deploys the branch to a throwaway Convex *preview* deployment, builds and starts the app, and runs the whole suite including the admin tests. It needs three repository secrets: `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk development instance) and `CONVEX_PREVIEW_DEPLOY_KEY` (Convex dashboard → project settings → *Preview deploy key*). In the Convex dashboard, set the preview deployments' default environment variables (`CLERK_JWT_ISSUER_DOMAIN`, `APP_URL`, and the n8n values or leave them unset so notifications fail visibly). Without the secrets the job prints a notice and passes without running. It can also be started by hand against any URL. **Not yet run in CI**: the same commands were verified locally, but the secrets-dependent path needs the secrets added first.

## How the tests were checked

- **Mutation checks.** Breaking a rule on purpose must fail a test: disabling the overlap check fails the double-booking tests; showing request actions regardless of status fails the component tests.
- **Real runtime, not only mocks.** The n8n workflows were run in the actual n8n container against a mock Convex that enforces the bearer token and signatures (signed, mismatched and bearer-only modes), and against the real Convex deployment for the claim call.
- **Tests found real bugs:** the public and unfiltered Browse lists ordered by category instead of time (see [decisions](decisions.md#12-newest-first-lists-need-an-index-that-ends-in-time-found-by-a-test)); a too-short description said "required"; the loans page opened on an empty tab for lenders.

## What is not covered

- Convex's production concurrency scheduler (the `convex-test` runtime is single-process, so concurrency tests cover the logic only).
- Real email delivery through a provider (workflows are tested against Mailpit and a mock Convex).
- Convex → n8n delivery over the public internet from a Convex cloud deployment in CI.
- Accessibility audits beyond roles, labels and `aria-invalid` assertions; visual regression.
