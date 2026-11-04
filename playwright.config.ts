import { defineConfig } from "@playwright/test";

/**
 * Browser tests drive a running LendLoop (local `npm run dev` / `npm start`, a preview, or a deployment).
 * They sign up throwaway members through Clerk's testing tokens, so they need a Clerk DEVELOPMENT instance:
 *   E2E_BASE_URL (default http://localhost:3000), CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 * Prefer a dev/staging Convex deployment: the tests remove their listings and Clerk users, but requests
 * and loans stay in the database.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } }],
});
