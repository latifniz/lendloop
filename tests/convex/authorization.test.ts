import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  PAGE,
  VALID_TOOL,
  createRequest,
  createTestConvex,
  createTool,
  createUser,
  makeAdmin,
  useFixedClock,
  type TestConvex,
} from "../helpers";

let t: TestConvex;
beforeEach(() => {
  useFixedClock();
  t = createTestConvex();
});
afterEach(() => vi.useRealTimers());

describe("authentication", () => {
  it("rejects unauthenticated tool creation", async () => {
    await expect(t.mutation(api.tools.create, VALID_TOOL)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  it("rejects unauthenticated access to private queries", async () => {
    await expect(t.query(api.requests.listMine, { paginationOpts: PAGE })).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
    await expect(t.query(api.dashboard.summary, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("creates new users with the least-privileged role", async () => {
    const alice = await createUser(t, "alice");
    const me = await alice.asUser.query(api.users.current, {});
    expect(me).toMatchObject({ role: "user", isTrustedLender: false });
  });

  it("does not let a client choose its role: store takes no arguments and stays idempotent", async () => {
    const alice = await createUser(t, "alice");
    // Extra arguments are rejected by Convex argument validation.
    await expect(
      alice.asUser.mutation(api.users.store, { role: "admin" } as never),
    ).rejects.toThrow();
    const again = await alice.asUser.mutation(api.users.store, {});
    expect(again).toBe(alice.id);
    expect(await alice.asUser.query(api.users.current, {})).toMatchObject({ role: "user" });
  });
});

describe("tool ownership", () => {
  it("forbids editing another user's listing", async () => {
    const owner = await createUser(t, "owner");
    const intruder = await createUser(t, "intruder");
    const toolId = await createTool(owner);
    await expect(
      intruder.asUser.mutation(api.tools.update, { toolId, ...VALID_TOOL, name: "Hijacked" }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(intruder.asUser.query(api.tools.getForEdit, { toolId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  it("forbids removing another user's listing and leaves it available", async () => {
    const owner = await createUser(t, "owner");
    const intruder = await createUser(t, "intruder");
    const toolId = await createTool(owner);
    await expect(intruder.asUser.mutation(api.tools.remove, { toolId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(1);
  });

  it("lets the owner edit and remove their own listing", async () => {
    const owner = await createUser(t, "owner");
    const toolId = await createTool(owner);
    await owner.asUser.mutation(api.tools.update, { toolId, ...VALID_TOOL, name: "Impact driver" });
    const page = await owner.asUser.query(api.tools.listMine, { paginationOpts: PAGE });
    expect(page.page[0]?.name).toBe("Impact driver");
    await owner.asUser.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });

  it("validates tool fields on the backend", async () => {
    const owner = await createUser(t, "owner");
    await expect(
      owner.asUser.mutation(api.tools.create, { ...VALID_TOOL, category: "Weapons" }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
    await expect(
      owner.asUser.mutation(api.tools.create, { ...VALID_TOOL, name: "x".repeat(81) }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });
});

describe("IDOR protection on private records", () => {
  it("hides requests from non-participants, answering NOT_FOUND for guessed ids", async () => {
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId);

    await expect(stranger.asUser.query(api.requests.get, { requestId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    for (const mutation of [api.requests.approve, api.requests.decline, api.requests.cancel]) {
      await expect(stranger.asUser.mutation(mutation, { requestId })).rejects.toMatchObject({
        data: { code: "NOT_FOUND" },
      });
    }
    expect((await stranger.asUser.query(api.requests.listIncoming, { paginationOpts: PAGE })).page).toHaveLength(0);
    expect((await stranger.asUser.query(api.requests.listMine, { paginationOpts: PAGE })).page).toHaveLength(0);
    // Participants still can.
    expect(await borrower.asUser.query(api.requests.get, { requestId })).toMatchObject({ viewerRole: "borrower" });
    expect(await lender.asUser.query(api.requests.get, { requestId })).toMatchObject({ viewerRole: "lender" });
  });

  it("hides loans from non-participants and blocks them from returning", async () => {
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });

    await expect(stranger.asUser.query(api.loans.get, { loanId })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(stranger.asUser.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    expect((await stranger.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE })).page).toHaveLength(0);
  });

  it("does not expose email or ids of other users through browse results", async () => {
    const owner = await createUser(t, "owner", "Olive Owner");
    const viewer = await createUser(t, "viewer");
    await createTool(owner);
    const browse = await viewer.asUser.query(api.tools.listBrowse, { paginationOpts: PAGE });
    const serialized = JSON.stringify(browse.page);
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain(owner.id);
    expect(serialized).not.toContain("user_owner");
    expect(browse.page[0]).toMatchObject({ ownerName: "Olive Owner", isMine: false });
  });
});

describe("request and loan roles", () => {
  it("lets only the lender approve or decline, only the borrower cancel", async () => {
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(lender);
    const requestId = await createRequest(borrower, toolId);

    await expect(borrower.asUser.mutation(api.requests.approve, { requestId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(borrower.asUser.mutation(api.requests.decline, { requestId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(lender.asUser.mutation(api.requests.cancel, { requestId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  it("lets only the lender mark a loan returned (borrower is a participant but not allowed)", async () => {
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(lender);
    const loanId = await lender.asUser.mutation(api.requests.approve, {
      requestId: await createRequest(borrower, toolId),
    });
    await expect(borrower.asUser.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    expect((await borrower.asUser.query(api.loans.get, { loanId })).status).toBe("returned");
  });
});

describe("admin permissions", () => {
  it("blocks normal users from every admin query and mutation", async () => {
    const user = await createUser(t, "user");
    const other = await createUser(t, "other");
    await expect(user.asUser.query(api.users.listForAdmin, { paginationOpts: PAGE })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(user.asUser.query(api.loans.listForAdmin, { paginationOpts: PAGE })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(user.asUser.query(api.automation.listRecent, { paginationOpts: PAGE })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(user.asUser.query(api.tools.listForAdmin, { paginationOpts: PAGE })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(
      user.asUser.mutation(api.users.setTrustedLender, { userId: other.id, isTrustedLender: true }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    // Self-promotion is also impossible.
    await expect(
      user.asUser.mutation(api.users.setTrustedLender, { userId: user.id, isTrustedLender: true }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it("lets admins mark a lender as trusted, and the badge shows up in browse", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const lender = await createUser(t, "lender");
    const viewer = await createUser(t, "viewer");
    await createTool(lender);
    await admin.asUser.mutation(api.users.setTrustedLender, { userId: lender.id, isTrustedLender: true });
    const browse = await viewer.asUser.query(api.tools.listBrowse, { paginationOpts: PAGE });
    expect(browse.page[0]?.ownerIsTrusted).toBe(true);
  });

  it("lets admins remove any listing and view all loans", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(lender);
    const secondTool = await createTool(lender, { name: "Hedge trimmer", category: "Garden" });
    await lender.asUser.mutation(api.requests.approve, { requestId: await createRequest(borrower, secondTool) });

    await admin.asUser.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(1);

    const loans = await admin.asUser.query(api.loans.listForAdmin, { paginationOpts: PAGE });
    expect(loans.page).toHaveLength(1);
  });
});

describe("public landing query", () => {
  it("returns only name and category, never private fields", async () => {
    const owner = await createUser(t, "owner", "Private Person");
    await createTool(owner, { description: "Call me on 555-0100" });
    const publicTools = await t.query(api.tools.listPublic, {});
    expect(publicTools).toEqual([{ name: "Cordless drill", category: "Power tools" }]);
    const text = JSON.stringify(publicTools);
    expect(text).not.toContain("Private Person");
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain(owner.id);
  });

  it("excludes unavailable and removed listings", async () => {
    const owner = await createUser(t, "owner");
    const hidden = await createTool(owner, { name: "Paused tool" });
    const removed = await createTool(owner, { name: "Removed tool" });
    await owner.asUser.mutation(api.tools.update, { toolId: hidden, ...VALID_TOOL, name: "Paused tool", status: "unavailable" });
    await owner.asUser.mutation(api.tools.remove, { toolId: removed });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });
});
