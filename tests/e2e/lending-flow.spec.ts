import { expect, test, type Browser } from "@playwright/test";
import { RUN, addTool, card, confirmDialog, day, deleteClerkUsers, newMember, open, requestTool, signUp, type Member } from "./support";

/**
 * One story, three members: a lender lists tools, a borrower requests, a second borrower collides.
 * Serial on purpose: each step builds on the last, and the suite cleans up what it created.
 */
test.describe.configure({ mode: "serial" });

const DRILL = `E2E Drill ${RUN}`;
const MOWER = `E2E Mower ${RUN}`;
const XSS = `E2E <img src=x onerror=alert(1)> ${RUN}`;

let lender: Member;
let borrower: Member;
let neighbour: Member;
const dialogs: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  lender = await newMember(browser, "lender");
  borrower = await newMember(browser, "borrower");
  neighbour = await newMember(browser, "neighbour");
  for (const member of [lender, borrower, neighbour]) member.page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
});

test.afterAll(async () => {
  // Best effort: remove the listings through the UI and the throwaway Clerk users, even after a failure.
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await open(lender.page, "/tools/mine");
      const remove = lender.page.getByRole("button", { name: "Remove", exact: true }).first();
      if (!(await remove.count())) break;
      await remove.click();
      await confirmDialog(lender.page, /remove|delete/i);
    }
  } catch {
    /* the lender's session may not exist if sign-up failed */
  }
  await deleteClerkUsers([lender, borrower, neighbour].filter(Boolean).map((member) => member.email));
});

test("three members sign up with an emailed code and land on the dashboard", async () => {
  for (const member of [lender, borrower, neighbour]) {
    await signUp(member);
    await expect(member.page.locator("main#main")).toBeVisible();
  }
});

test("an empty listing form shows validation errors, and a too-short description says so", async () => {
  const { page } = lender;
  await open(page, "/tools/new");
  await page.getByRole("button", { name: "List tool" }).click();
  await expect(page.locator('#tool-name[aria-invalid="true"]')).toBeVisible();
  await page.fill("#tool-name", "Short desc");
  await page.selectOption("#tool-category", "Other");
  await page.selectOption("#tool-condition", "Good");
  await page.fill("#tool-description", "tiny");
  await page.getByRole("button", { name: "List tool" }).click();
  await expect(page.getByText("Description must be at least 10 characters")).toBeVisible();
});

test("the lender lists two tools and a listing whose name is HTML renders as plain text", async () => {
  await addTool(lender.page, { name: DRILL, category: "Power tools", condition: "Good", description: "Test drill, safe to delete." });
  await addTool(lender.page, { name: MOWER, category: "Garden", condition: "Like new", description: "Test mower, safe to delete." });
  await addTool(lender.page, { name: XSS, category: "Other", condition: "Fair", description: "Markup in the name must stay text." });
  await lender.page.waitForTimeout(1500);
  expect(dialogs).toEqual([]);
  await expect(lender.page.locator("img[src='x']")).toHaveCount(0);
});

test("the lender can edit a listing", async () => {
  const { page } = lender;
  await open(page, "/tools/mine");
  await card(page, DRILL).getByRole("link", { name: /edit/i }).first().click();
  await page.waitForURL(/\/edit/);
  await page.fill("#tool-description", "Test drill, EDITED.");
  await page.getByRole("button", { name: /save/i }).click();
  await page.waitForURL(/tools\/mine/);
  await expect(page.getByText("EDITED").first()).toBeVisible();
});

test("a borrower browses, filters by category and is refused bad date ranges", async () => {
  const { page } = borrower;
  await open(page, "/tools");
  await expect(card(page, DRILL)).toBeVisible();
  await page.getByRole("button", { name: /^Garden$/ }).click();
  await expect(card(page, MOWER)).toBeVisible();
  await expect(page.getByRole("heading", { name: DRILL, exact: true })).toHaveCount(0);
  await open(page, "/tools");
  await card(page, DRILL).getByRole("button", { name: "Request to borrow", exact: true }).click();
  await page.fill("#request-start", day(5));
  await page.fill("#request-end", day(2));
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/after|before|end|return/i).first()).toBeVisible();
  await page.fill("#request-start", day(2));
  await page.fill("#request-end", day(40));
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/30/).first()).toBeVisible();
});

test("a valid request appears as Pending, and an overlapping one from a neighbour is accepted as Pending too", async () => {
  await requestTool(borrower.page, DRILL, 2, 5, "Weekend project B");
  await open(borrower.page, "/requests");
  await expect(card(borrower.page, DRILL, "Weekend project B").getByText(/pending/i)).toBeVisible();
  await requestTool(neighbour.page, DRILL, 3, 6, "Overlap request C");
  await open(neighbour.page, "/requests");
  await expect(card(neighbour.page, DRILL, "Overlap request C").getByText(/pending/i)).toBeVisible();
});

test("the lender sees both requests, and a new request arrives on an open page without reloading", async () => {
  const { page } = lender;
  await open(page, "/requests/incoming");
  await expect(card(page, DRILL, "Weekend project B")).toBeVisible();
  await expect(card(page, DRILL, "Overlap request C")).toBeVisible();
  await requestTool(borrower.page, MOWER, 20, 22, "Realtime probe");
  await expect(card(page, MOWER, "Realtime probe")).toBeVisible({ timeout: 20_000 });
});

test("approving creates a loan; approving the overlapping request is refused and stays Pending", async () => {
  const { page } = lender;
  await open(page, "/requests/incoming");
  await card(page, DRILL, "Weekend project B").getByRole("button", { name: "Approve", exact: true }).click();
  await confirmDialog(page, /^Approve$/);
  await expect(card(page, DRILL, "Weekend project B").getByText(/approved/i)).toBeVisible();

  await card(page, DRILL, "Overlap request C").getByRole("button", { name: "Approve", exact: true }).click();
  await confirmDialog(page, /^Approve$/);
  await expect(page.getByText(/overlap|already|conflict|not available|booked|unavailable/i).first()).toBeVisible();
  await expect(card(page, DRILL, "Overlap request C").getByText(/pending/i)).toBeVisible();
});

test("the lender declines the overlapping request and both borrowers see their own outcome", async () => {
  const { page } = lender;
  await card(page, DRILL, "Overlap request C").getByRole("button", { name: "Decline", exact: true }).click();
  await confirmDialog(page, /^Decline$/);
  await expect(card(page, DRILL, "Overlap request C").getByText(/declined/i)).toBeVisible();
  await open(borrower.page, "/requests");
  await expect(card(borrower.page, DRILL, "Weekend project B").getByText(/approved/i)).toBeVisible();
  await open(neighbour.page, "/requests");
  await expect(card(neighbour.page, DRILL, "Overlap request C").getByText(/declined/i)).toBeVisible();
});

test("a borrower can cancel a pending request, after which the lender can no longer act on it", async () => {
  const { page } = borrower;
  await open(page, "/requests");
  await card(page, MOWER, "Realtime probe").getByRole("button", { name: "Cancel request", exact: true }).click();
  await confirmDialog(page, /^Cancel request$/);
  await expect(card(page, MOWER, "Realtime probe").getByText(/cancelled/i)).toBeVisible();
  await open(lender.page, "/requests/incoming");
  const row = card(lender.page, MOWER, "Realtime probe");
  await expect(row.getByText(/cancelled/i)).toBeVisible();
  await expect(row.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("a non-admin is refused the admin area, and cannot open someone else's edit page", async () => {
  const { page } = borrower;
  await open(page, "/admin");
  await expect(page.getByText(/administrators only/i)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByText("Admin")).toHaveCount(0);
  await open(lender.page, "/tools/mine");
  const editPath = await lender.page.locator('a[href*="/edit"]').first().getAttribute("href");
  await open(page, editPath!);
  await page.waitForTimeout(2500);
  await expect(page.locator("#tool-name")).toHaveCount(0);
});

test("only the lender can mark a loan returned, and My loans opens on the Lending tab for a lender", async () => {
  await open(borrower.page, "/loans");
  await expect(card(borrower.page, DRILL)).toBeVisible();
  await expect(borrower.page.getByRole("button", { name: "Mark as returned" })).toHaveCount(0);

  const { page } = lender;
  await open(page, "/loans");
  await expect(card(page, DRILL)).toBeVisible(); // no tab click: it opens on the tab that has loans
  await card(page, DRILL).getByRole("button", { name: "Mark as returned", exact: true }).click();
  await confirmDialog(page, /return/i);
  await expect(card(page, DRILL).getByText("Returned", { exact: true }).first()).toBeVisible();
});

test("the mobile layout opens the navigation drawer", async ({ browser }) => {
  const phone = await newMember(browser, "phone", { width: 390, height: 800 });
  try {
    await signUp(phone);
    await phone.page.getByRole("button", { name: "Open menu" }).click();
    await expect(phone.page.getByRole("dialog").getByText(/Browse/).first()).toBeVisible();
  } finally {
    await deleteClerkUsers([phone.email]);
  }
});
