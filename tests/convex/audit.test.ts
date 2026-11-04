import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { PAGE, createRequest, createTestConvex, createTool, createUser, makeAdmin, useFixedClock, type TestConvex } from "../helpers";

let t: TestConvex;

beforeEach(() => {
  useFixedClock();
  t = createTestConvex();
});

async function auditRows(admin: Awaited<ReturnType<typeof createUser>>) {
  return (await admin.asUser.query(api.audit.listRecent, { paginationOpts: PAGE })).page;
}

describe("audit log", () => {
  it("records an admin removing someone else's listing, with the actor", async () => {
    const admin = await createUser(t, "admin", "Ada Admin");
    await makeAdmin(t, admin);
    const owner = await createUser(t, "owner");
    const toolId = await createTool(owner);
    await admin.asUser.mutation(api.tools.remove, { toolId });
    const [row] = await auditRows(admin);
    expect(row).toMatchObject({ action: "tool.removed_by_admin", targetType: "tool", targetId: toolId, actorName: "Ada Admin" });
  });

  it("does not record an owner removing their own listing", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const owner = await createUser(t, "owner");
    await owner.asUser.mutation(api.tools.remove, { toolId: await createTool(owner) });
    expect((await auditRows(admin)).filter((row) => row.action === "tool.removed_by_admin")).toHaveLength(0);
  });

  it("records trusted-lender changes only when the value actually changes", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const lender = await createUser(t, "lender");
    await admin.asUser.mutation(api.users.setTrustedLender, { userId: lender.id, isTrustedLender: true });
    await admin.asUser.mutation(api.users.setTrustedLender, { userId: lender.id, isTrustedLender: true });
    const rows = await auditRows(admin);
    expect(rows.filter((r) => r.action === "user.trusted_lender_changed")).toHaveLength(1);
    expect(rows[0]?.detail).toBe("isTrustedLender=true");
  });

  it("records role changes made from the dashboard with no human actor", async () => {
    const user = await createUser(t, "someone");
    await makeAdmin(t, user);
    const [row] = await auditRows(user);
    expect(row).toMatchObject({ action: "user.role_changed", actorName: "Convex dashboard", detail: "role=admin" });
  });

  it("records an admin retrying a failed notification", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const lender = await createUser(t, "lender");
    const borrower = await createUser(t, "borrower");
    await createRequest(borrower, await createTool(lender));
    const events = await admin.asUser.query(api.automation.listRecent, { paginationOpts: PAGE });
    const eventId = events.page[0]!._id;
    await t.run(async (ctx) => ctx.db.patch(eventId, { status: "failed", errorCode: "SMTP_TIMEOUT" }));
    await admin.asUser.mutation(api.automation.retryFailed, { eventId });
    const [row] = await auditRows(admin);
    expect(row).toMatchObject({ action: "automation.retry_requested", targetType: "automationEvent", detail: "was=SMTP_TIMEOUT" });
  });

  it("is readable by admins only", async () => {
    const user = await createUser(t, "member");
    await expect(user.asUser.query(api.audit.listRecent, { paginationOpts: PAGE })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it("stores no e-mail addresses or message text", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const owner = await createUser(t, "owner");
    await admin.asUser.mutation(api.tools.remove, { toolId: await createTool(owner) });
    expect(JSON.stringify(await t.run(async (ctx) => ctx.db.query("auditLogs").collect()))).not.toContain("@");
  });
});
