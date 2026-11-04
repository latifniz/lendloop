import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { PAGE, VALID_TOOL, createRequest, createTestConvex, createTool, createUser, makeAdmin, useFixedClock, type TestConvex } from "../helpers";

let t: TestConvex;
beforeEach(() => {
  useFixedClock();
  t = createTestConvex();
});

const browse = (user: Awaited<ReturnType<typeof createUser>>, category?: string) =>
  user.asUser.query(api.tools.listBrowse, { category, paginationOpts: PAGE });

async function setup() {
  const lender = await createUser(t, "lender", "Lena Lender");
  const borrower = await createUser(t, "borrower", "Ben Borrower");
  return { lender, borrower };
}

describe("public tool list", () => {
  it("returns only name and category, newest first, without removed tools", async () => {
    const { lender } = await setup();
    await createTool(lender, { name: "Older drill" });
    const removed = await createTool(lender, { name: "Removed saw" });
    await createTool(lender, { name: "Newer ladder", category: "Garden" });
    await lender.asUser.mutation(api.tools.remove, { toolId: removed });
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toEqual([
      { name: "Newer ladder", category: "Garden" },
      { name: "Older drill", category: "Power tools" },
    ]);
  });

  it("is capped at 24 entries and keeps the newest", async () => {
    const { lender } = await setup();
    for (let index = 0; index < 30; index += 1) await createTool(lender, { name: `Tool ${String(index).padStart(2, "0")}` });
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toHaveLength(24);
    expect(list[0]?.name).toBe("Tool 29");
    expect(list[23]?.name).toBe("Tool 06");
  });

  it("needs no sign-in", async () => {
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});

describe("browse tools", () => {
  it("shows other members' tools with a display name and trusted flag, never an email", async () => {
    const { lender, borrower } = await setup();
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    await createTool(lender);
    await admin.asUser.mutation(api.users.setTrustedLender, { userId: lender.id, isTrustedLender: true });
    const [tool] = (await browse(borrower)).page;
    expect(tool).toMatchObject({ name: "Cordless drill", ownerName: "Lena Lender", ownerIsTrusted: true, isMine: false, onLoanUntil: null });
    expect(JSON.stringify(tool)).not.toContain("@");
    expect(Object.keys(tool!)).not.toContain("ownerId");
  });

  it("is newest first across categories, not grouped by category", async () => {
    const { lender, borrower } = await setup();
    await createTool(lender, { name: "First (Power tools)", category: "Power tools" });
    await createTool(lender, { name: "Second (Garden)", category: "Garden" });
    await createTool(lender, { name: "Third (Camping)", category: "Camping" });
    expect((await browse(borrower)).page.map((tool) => tool.name)).toEqual(["Third (Camping)", "Second (Garden)", "First (Power tools)"]);
  });

  it("marks the caller's own listings", async () => {
    const { lender } = await setup();
    await createTool(lender);
    expect((await browse(lender)).page[0]?.isMine).toBe(true);
  });

  it("filters by category and rejects an unknown category", async () => {
    const { lender, borrower } = await setup();
    await createTool(lender, { name: "Drill", category: "Power tools" });
    await createTool(lender, { name: "Rake", category: "Garden" });
    expect((await browse(borrower, "Garden")).page.map((tool) => tool.name)).toEqual(["Rake"]);
    await expect(browse(borrower, "Weapons")).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });

  it("hides removed tools", async () => {
    const { lender, borrower } = await setup();
    const toolId = await createTool(lender);
    await lender.asUser.mutation(api.tools.remove, { toolId });
    expect((await browse(borrower)).page).toHaveLength(0);
  });

  it("paginates without gaps or duplicates", async () => {
    const { lender, borrower } = await setup();
    for (let index = 0; index < 7; index += 1) await createTool(lender, { name: `Tool ${index}` });
    const names: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const result: Awaited<ReturnType<typeof browse>> = await borrower.asUser.query(api.tools.listBrowse, { paginationOpts: { numItems: 3, cursor } });
      names.push(...result.page.map((tool) => tool.name));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(names).toEqual(["Tool 6", "Tool 5", "Tool 4", "Tool 3", "Tool 2", "Tool 1", "Tool 0"]);
  });

  it("shows when a tool is on loan, and clears it once returned", async () => {
    const { lender, borrower } = await setup();
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId, 2, 5);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });
    expect((await browse(borrower)).page[0]?.onLoanUntil).not.toBeNull();
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    expect((await browse(borrower)).page[0]?.onLoanUntil).toBeNull();
  });

  it("requires sign-in", async () => {
    await expect(t.query(api.tools.listBrowse, { paginationOpts: PAGE })).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });
});

describe("my listings and the edit form", () => {
  it("lists only the caller's own non-removed tools", async () => {
    const { lender, borrower } = await setup();
    await createTool(lender, { name: "Mine" });
    const gone = await createTool(lender, { name: "Gone" });
    await createTool(borrower, { name: "Theirs" });
    await lender.asUser.mutation(api.tools.remove, { toolId: gone });
    const mine = await lender.asUser.query(api.tools.listMine, { paginationOpts: PAGE });
    expect(mine.page.map((tool) => tool.name)).toEqual(["Mine"]);
  });

  it("lets only the owner read the edit form, and returns every editable field", async () => {
    const { lender, borrower } = await setup();
    const toolId = await createTool(lender);
    expect(await lender.asUser.query(api.tools.getForEdit, { toolId })).toMatchObject({ ...VALID_TOOL, status: "available" });
    await expect(borrower.asUser.query(api.tools.getForEdit, { toolId })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it("updates a listing and rejects invalid input", async () => {
    const { lender } = await setup();
    const toolId = await createTool(lender);
    await lender.asUser.mutation(api.tools.update, { toolId, ...VALID_TOOL, name: "Renamed drill" });
    expect((await lender.asUser.query(api.tools.getForEdit, { toolId })).name).toBe("Renamed drill");
    await expect(lender.asUser.mutation(api.tools.update, { toolId, ...VALID_TOOL, description: "tiny" })).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });
});

describe("dashboard", () => {
  it("counts only the caller's own listings, requests and loans", async () => {
    const { lender, borrower } = await setup();
    const bystander = await createUser(t, "bystander");
    const toolId = await createTool(lender);
    await createTool(bystander);
    await createRequest(borrower, toolId, 2, 3);
    expect(await lender.asUser.query(api.dashboard.summary, {})).toMatchObject({ activeListings: 1, incomingPendingRequests: 1, myPendingRequests: 0, activeLoans: 0 });
    expect(await borrower.asUser.query(api.dashboard.summary, {})).toMatchObject({ activeListings: 0, incomingPendingRequests: 0, myPendingRequests: 1 });
    expect(await bystander.asUser.query(api.dashboard.summary, {})).toMatchObject({ activeListings: 1, incomingPendingRequests: 0, myPendingRequests: 0 });
  });

  it("shows each member only the notifications addressed to them", async () => {
    const { lender, borrower } = await setup();
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId);
    await lender.asUser.mutation(api.requests.approve, { requestId });
    const lenderEvents = await lender.asUser.query(api.dashboard.recentActivity, {});
    const borrowerEvents = await borrower.asUser.query(api.dashboard.recentActivity, {});
    expect(lenderEvents.map((event) => event.eventType)).toEqual(["request.created"]);
    expect(borrowerEvents.map((event) => event.eventType)).toEqual(["request.approved"]);
  });
});

describe("request and loan lists", () => {
  it("scopes My requests to the borrower and Incoming requests to the lender, with status filters", async () => {
    const { lender, borrower } = await setup();
    const other = await createUser(t, "other");
    const toolId = await createTool(lender);
    const first = await createRequest(borrower, toolId, 2, 3);
    await createRequest(other, toolId, 10, 11);
    await lender.asUser.mutation(api.requests.decline, { requestId: first });
    const mine = await borrower.asUser.query(api.requests.listMine, { paginationOpts: PAGE });
    expect(mine.page).toHaveLength(1);
    const incoming = await lender.asUser.query(api.requests.listIncoming, { paginationOpts: PAGE });
    expect(incoming.page).toHaveLength(2);
    const pendingOnly = await lender.asUser.query(api.requests.listIncoming, { status: "pending", paginationOpts: PAGE });
    expect(pendingOnly.page).toHaveLength(1);
    expect((await other.asUser.query(api.requests.listIncoming, { paginationOpts: PAGE })).page).toHaveLength(0);
  });

  it("lists loans by role and lets admins filter all loans by status", async () => {
    const { lender, borrower } = await setup();
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId, 2, 4);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });
    expect((await borrower.asUser.query(api.loans.listMine, { role: "borrower", paginationOpts: PAGE })).page[0]?.viewerRole).toBe("borrower");
    expect((await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE })).page[0]?.viewerRole).toBe("lender");
    expect((await borrower.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE })).page).toHaveLength(0);
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    expect((await admin.asUser.query(api.loans.listForAdmin, { status: "returned", paginationOpts: PAGE })).page).toHaveLength(1);
    expect((await admin.asUser.query(api.loans.listForAdmin, { status: "active", paginationOpts: PAGE })).page).toHaveLength(0);
  });
});

describe("members", () => {
  it("returns the caller's own record from users.current and null when signed out", async () => {
    const { lender } = await setup();
    expect(await lender.asUser.query(api.users.current, {})).toMatchObject({ name: "Lena Lender", role: "user" });
    expect(await t.query(api.users.current, {})).toBeNull();
  });

  it("gives admins the member list and nobody else", async () => {
    const { lender } = await setup();
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    expect((await admin.asUser.query(api.users.listForAdmin, { paginationOpts: PAGE })).page.length).toBeGreaterThanOrEqual(3);
    await expect(lender.asUser.query(api.users.listForAdmin, { paginationOpts: PAGE })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});
