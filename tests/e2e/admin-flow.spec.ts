import { expect, test, type Browser } from "@playwright/test";
import { RUN, addTool, adminBootstrapEnabled, adminRow, card, confirmDialog, deleteClerkUsers, makeAdmin, newMember, open, requestTool, signUp, type Member } from "./support";

test.skip(!adminBootstrapEnabled, "set E2E_ADMIN_BOOTSTRAP=convex-cli (and point the Convex CLI at a dev deployment) to run the admin tests");
test.describe.configure({ mode: "serial" });

const TOOL = `E2E Admin Tool ${RUN}`;
let admin: Member;
let lender: Member;
let borrower: Member;

const adminTab = async (member: Member, tab: string) => {
  await open(member.page, "/admin");
  await member.page.getByRole("button", { name: tab, exact: true }).click();
};

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  admin = await newMember(browser, "admin");
  lender = await newMember(browser, "lender2");
  borrower = await newMember(browser, "borrower2");
  for (const member of [admin, lender, borrower]) await signUp(member);
  await addTool(lender.page, { name: TOOL, category: "Garden", condition: "Good", description: "Admin test listing, safe to delete." });
  await requestTool(borrower.page, TOOL, 2, 4, "Admin flow request");
  await makeAdmin(admin.email);
});

test.afterAll(async () => {
  await deleteClerkUsers([admin, lender, borrower].filter(Boolean).map((member) => member.email));
});

test("only the promoted member sees the Admin section", async () => {
  await open(admin.page, "/dashboard");
  await expect(admin.page.getByRole("navigation", { name: "Main" }).getByText("Admin")).toBeVisible();
  await open(lender.page, "/dashboard");
  await expect(lender.page.getByRole("navigation", { name: "Main" }).getByText("Admin")).toHaveCount(0);
  await open(lender.page, "/admin");
  await expect(lender.page.getByText(/administrators only/i)).toBeVisible();
});

test("the Listings tab shows every listing, including other members'", async () => {
  await open(admin.page, "/admin");
  await expect(adminRow(admin.page, TOOL)).toBeVisible();
});

test("marking a lender trusted shows the badge to borrowers, and removing it takes the badge away", async () => {
  await adminTab(admin, "Members");
  const row = adminRow(admin.page, lender.email);
  await row.getByRole("button", { name: /mark trusted/i }).click();
  await expect(row.getByRole("button", { name: /remove trusted/i })).toBeVisible();
  await open(borrower.page, "/tools");
  await expect(card(borrower.page, TOOL).getByText(/trusted lender/i)).toBeVisible();

  await adminTab(admin, "Members");
  await adminRow(admin.page, lender.email).getByRole("button", { name: /remove trusted/i }).click();
  await expect(adminRow(admin.page, lender.email).getByRole("button", { name: /mark trusted/i })).toBeVisible();
});

test("the Loans tab lists a loan once the lender approves, and filters by status", async () => {
  await open(lender.page, "/requests/incoming");
  await card(lender.page, TOOL, "Admin flow request").getByRole("button", { name: "Approve", exact: true }).click();
  await confirmDialog(lender.page, /^Approve$/);
  await expect(card(lender.page, TOOL, "Admin flow request").getByText(/approved/i)).toBeVisible();

  await adminTab(admin, "Loans");
  await expect(adminRow(admin.page, TOOL)).toBeVisible();
  await admin.page.getByRole("button", { name: "Returned", exact: true }).click();
  // Other runs may have left returned loans behind, so assert this loan's absence, not an empty list.
  await expect(admin.page.locator("div.p-4").filter({ hasText: TOOL })).toHaveCount(0);
  await admin.page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(adminRow(admin.page, TOOL)).toBeVisible();
});

test("the Automation tab records the notifications the requests produced", async () => {
  await adminTab(admin, "Automation");
  await expect(admin.page.getByText("request.created").first()).toBeVisible();
  await expect(admin.page.getByText("request.approved").first()).toBeVisible();
});

test("an admin can remove another member's listing, and it disappears for borrowers", async () => {
  await open(admin.page, "/admin");
  const row = adminRow(admin.page, TOOL);
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await confirmDialog(admin.page, /remove listing/i);
  await expect(adminRow(admin.page, TOOL).getByText("Removed", { exact: true })).toBeVisible();
  await open(borrower.page, "/tools");
  await expect(borrower.page.getByRole("heading", { name: TOOL, exact: true })).toHaveCount(0);
});

test("the audit log names who did what, including the role change made from the CLI", async () => {
  await adminTab(admin, "Audit log");
  const page = admin.page;
  await expect(page.getByText("Removed a listing").first()).toBeVisible();
  await expect(page.getByText("Changed a lender's trusted status").first()).toBeVisible();
  await expect(page.getByText("Changed a member's role").first()).toBeVisible();
  await expect(page.getByText("Convex dashboard").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/@[\w-]+\.(com|test)/);
});
