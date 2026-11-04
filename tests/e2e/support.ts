import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { execFileSync } from "node:child_process";
import type { Browser, Locator, Page } from "@playwright/test";

export const RUN = Date.now().toString(36);
export const PASSWORD = `Lend!Loop#${RUN}Zq9`;
export const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export type Member = { label: string; email: string; page: Page };

/** Clerk development instances accept `+clerk_test` addresses with the fixed code 424242. */
export async function newMember(browser: Browser, label: string, viewport = { width: 1280, height: 800 }): Promise<Member> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await setupClerkTestingToken({ page });
  return { label, email: `e2e+clerk_test_${label}_${RUN}@example.com`, page };
}

export async function signUp({ page, email }: Member): Promise<void> {
  await page.goto("/sign-up");
  await page.fill('input[name="emailAddress"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const code = page.locator('input[autocomplete="one-time-code"]').first();
  await code.waitFor();
  await code.click();
  await page.keyboard.type("424242", { delay: 60 });
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Navigates and waits for hydration, so typing into forms is not wiped by React taking over. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** A card (listing, request or loan) identified by its heading, optionally narrowed by other text on it. */
export function card(page: Page, heading: string, containing?: string): Locator {
  const base = page.locator("div.p-5").filter({ has: page.locator("h3", { hasText: heading }) });
  return (containing ? base.filter({ hasText: containing }) : base).first();
}

export async function confirmDialog(page: Page, button: RegExp): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: button }).click();
  await dialog.waitFor({ state: "hidden" });
}

export async function addTool(page: Page, tool: { name: string; category: string; condition: string; description: string }): Promise<void> {
  await open(page, "/tools/new");
  await page.fill("#tool-name", tool.name);
  await page.selectOption("#tool-category", tool.category);
  await page.selectOption("#tool-condition", tool.condition);
  await page.fill("#tool-description", tool.description);
  await page.getByRole("button", { name: "List tool" }).click();
  await page.waitForURL(/tools\/mine/);
}

export async function requestTool(page: Page, tool: string, startOffset: number, endOffset: number, message: string): Promise<void> {
  await open(page, "/tools");
  await card(page, tool).getByRole("button", { name: "Request to borrow", exact: true }).click();
  await page.fill("#request-start", day(startOffset));
  await page.fill("#request-end", day(endOffset));
  await page.fill("#request-message", message);
  await page.getByRole("button", { name: "Send request" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

/** Removes the throwaway Clerk users so the dev instance does not fill up with test accounts. */
export async function deleteClerkUsers(emails: string[]): Promise<void> {
  const headers = { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` };
  for (const email of emails) {
    const found = (await (await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers })).json()) as Array<{ id: string }>;
    for (const user of found) await fetch(`https://api.clerk.com/v1/users/${user.id}`, { method: "DELETE", headers });
  }
}

/**
 * Role changes are deliberately impossible from the browser, so admin tests promote a member the same way
 * an operator would: the Convex CLI running the internal `users:setRole` against the deployment in .env.local.
 * Opt in with E2E_ADMIN_BOOTSTRAP=convex-cli (use a dev deployment).
 */
export const adminBootstrapEnabled = process.env.E2E_ADMIN_BOOTSTRAP === "convex-cli";

export async function makeAdmin(email: string): Promise<void> {
  const headers = { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` };
  const found = (await (await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers })).json()) as Array<{ id: string }>;
  if (!found[0]) throw new Error(`No Clerk user for ${email}`);
  execFileSync("npx", ["convex", "run", "users:setRole", JSON.stringify({ clerkId: found[0].id, role: "admin" })], { stdio: "pipe" });
}

/** An admin-panel row (listing, member, loan or automation event) containing the given text. */
export function adminRow(page: Page, text: string): Locator {
  return page.locator("div.p-4").filter({ hasText: text }).first();
}
