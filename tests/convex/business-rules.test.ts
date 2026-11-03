import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  PAGE,
  createRequest,
  createTestConvex,
  createTool,
  createUser,
  dayOffset,
  useFixedClock,
  type TestConvex,
} from "../helpers";

let t: TestConvex;
beforeEach(() => {
  useFixedClock();
  t = createTestConvex();
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const lender = await createUser(t, "lender", "Lena Lender");
  const borrower = await createUser(t, "borrower", "Ben Borrower");
  const toolId = await createTool(lender);
  return { lender, borrower, toolId };
}

describe("creating requests", () => {
  it("rejects borrowing your own tool", async () => {
    const { lender, toolId } = await setup();
    await expect(createRequest(lender, toolId)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  it.each([
    ["start equals end", 3, 3],
    ["start after end", 5, 2],
    ["start in the past", -2, 1],
    ["longer than 30 days", 1, 40],
    ["more than a year ahead", 400, 402],
  ])("rejects invalid date range: %s", async (_label, start, end) => {
    const { borrower, toolId } = await setup();
    await expect(createRequest(borrower, toolId, start, end)).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });

  it("rejects dates that are not whole UTC days and non-finite values", async () => {
    const { borrower, toolId } = await setup();
    await expect(
      borrower.asUser.mutation(api.requests.create, { toolId, startDate: dayOffset(2) + 1000, endDate: dayOffset(4) }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
    await expect(
      borrower.asUser.mutation(api.requests.create, { toolId, startDate: Number.NaN, endDate: dayOffset(4) }),
    ).rejects.toBeTruthy();
  });

  it("rejects an over-long message", async () => {
    const { borrower, toolId } = await setup();
    await expect(
      borrower.asUser.mutation(api.requests.create, {
        toolId,
        startDate: dayOffset(2),
        endDate: dayOffset(3),
        message: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ data: { code: "VALIDATION" } });
  });

  it("prevents duplicate overlapping pending requests from the same borrower", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId, 2, 5);
    await expect(createRequest(borrower, toolId, 4, 6)).rejects.toMatchObject({ data: { code: "CONFLICT" } });
  });

  it("does not accept requests for removed or unavailable tools", async () => {
    const { lender, borrower, toolId } = await setup();
    await lender.asUser.mutation(api.tools.remove, { toolId });
    await expect(createRequest(borrower, toolId)).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});

describe("approval and overlap prevention", () => {
  it("approves a valid request, creating exactly one active loan", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });

    const loans = await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE });
    expect(loans.page).toHaveLength(1);
    expect(loans.page[0]).toMatchObject({ _id: loanId, status: "active", borrowerName: "Ben Borrower" });
    expect((await borrower.asUser.query(api.requests.get, { requestId })).status).toBe("approved");
  });

  it("rejects approving a second request whose dates overlap an existing loan", async () => {
    const { lender, borrower, toolId } = await setup();
    const other = await createUser(t, "other");
    const first = await createRequest(borrower, toolId, 2, 6);
    const second = await createRequest(other, toolId, 4, 8);
    await lender.asUser.mutation(api.requests.approve, { requestId: first });
    await expect(lender.asUser.mutation(api.requests.approve, { requestId: second })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
    expect((await other.asUser.query(api.requests.get, { requestId: second })).status).toBe("pending");
  });

  it("allows back-to-back loans (end of one equals start of the next)", async () => {
    const { lender, borrower, toolId } = await setup();
    const other = await createUser(t, "other");
    const first = await createRequest(borrower, toolId, 2, 5);
    const second = await createRequest(other, toolId, 5, 8);
    await lender.asUser.mutation(api.requests.approve, { requestId: first });
    await expect(lender.asUser.mutation(api.requests.approve, { requestId: second })).resolves.toBeTruthy();
  });

  it("frees the dates again once the loan is returned", async () => {
    const { lender, borrower, toolId } = await setup();
    const other = await createUser(t, "other");
    const first = await createRequest(borrower, toolId, 2, 6);
    const second = await createRequest(other, toolId, 3, 5);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId: first });
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    await expect(lender.asUser.mutation(api.requests.approve, { requestId: second })).resolves.toBeTruthy();
  });

  it("allows only one of two concurrent approvals for overlapping periods", async () => {
    const { lender, borrower, toolId } = await setup();
    const other = await createUser(t, "other");
    const first = await createRequest(borrower, toolId, 2, 6);
    const second = await createRequest(other, toolId, 4, 8);

    const results = await Promise.allSettled([
      lender.asUser.mutation(api.requests.approve, { requestId: first }),
      lender.asUser.mutation(api.requests.approve, { requestId: second }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const loans = await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE });
    expect(loans.page).toHaveLength(1);
  });

  it("cannot create duplicate loans by approving the same request twice, even concurrently", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    const results = await Promise.allSettled([
      lender.asUser.mutation(api.requests.approve, { requestId }),
      lender.asUser.mutation(api.requests.approve, { requestId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loans = await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE });
    expect(loans.page).toHaveLength(1);
  });
});

describe("request lifecycle", () => {
  it("does not allow approving a declined request", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    await lender.asUser.mutation(api.requests.decline, { requestId });
    await expect(lender.asUser.mutation(api.requests.approve, { requestId })).rejects.toMatchObject({
      data: { code: "INVALID_STATE" },
    });
    const loans = await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE });
    expect(loans.page).toHaveLength(0);
  });

  it("does not allow approving a cancelled request", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    await borrower.asUser.mutation(api.requests.cancel, { requestId });
    await expect(lender.asUser.mutation(api.requests.approve, { requestId })).rejects.toMatchObject({
      data: { code: "INVALID_STATE" },
    });
  });

  it("does not allow cancelling or declining an approved request", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    await lender.asUser.mutation(api.requests.approve, { requestId });
    await expect(borrower.asUser.mutation(api.requests.cancel, { requestId })).rejects.toMatchObject({
      data: { code: "INVALID_STATE" },
    });
    await expect(lender.asUser.mutation(api.requests.decline, { requestId })).rejects.toMatchObject({
      data: { code: "INVALID_STATE" },
    });
  });

  it("creates loans only from approved requests (pending, declined and cancelled leave no loan)", async () => {
    const { lender, borrower, toolId } = await setup();
    const pending = await createRequest(borrower, toolId, 2, 3);
    const declined = await createRequest(borrower, toolId, 5, 6);
    const cancelled = await createRequest(borrower, toolId, 8, 9);
    await lender.asUser.mutation(api.requests.decline, { requestId: declined });
    await borrower.asUser.mutation(api.requests.cancel, { requestId: cancelled });
    expect(pending).toBeTruthy();
    const loans = await lender.asUser.query(api.loans.listMine, { role: "lender", paginationOpts: PAGE });
    expect(loans.page).toHaveLength(0);
  });

  it("closes pending requests when the listing is removed", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    await lender.asUser.mutation(api.tools.remove, { toolId });
    expect((await borrower.asUser.query(api.requests.get, { requestId })).status).toBe("cancelled");
  });

  it("blocks owners from removing a tool that is out on loan", async () => {
    const { lender, borrower, toolId } = await setup();
    await lender.asUser.mutation(api.requests.approve, { requestId: await createRequest(borrower, toolId) });
    await expect(lender.asUser.mutation(api.tools.remove, { toolId })).rejects.toMatchObject({
      data: { code: "CONFLICT" },
    });
  });
});

describe("loan lifecycle", () => {
  it("rejects returning a loan twice", async () => {
    const { lender, borrower, toolId } = await setup();
    const loanId = await lender.asUser.mutation(api.requests.approve, {
      requestId: await createRequest(borrower, toolId),
    });
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    await expect(lender.asUser.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject({
      data: { code: "INVALID_STATE" },
    });
  });

  it("records the return time and keeps the request approved", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
    const loan = await lender.asUser.query(api.loans.get, { loanId });
    expect(loan.status).toBe("returned");
    expect(loan.returnedAt).toBeTypeOf("number");
    expect((await lender.asUser.query(api.requests.get, { requestId })).status).toBe("approved");
  });

  it("presents a loan as overdue once its due day has fully passed, and still allows the return", async () => {
    const { lender, borrower, toolId } = await setup();
    const loanId = await lender.asUser.mutation(api.requests.approve, {
      requestId: await createRequest(borrower, toolId, 1, 2),
    });
    vi.setSystemTime(dayOffset(2) + 12 * 3600 * 1000); // due day still in progress
    expect((await lender.asUser.query(api.loans.get, { loanId })).status).toBe("active");
    vi.setSystemTime(dayOffset(4)); // two days after the due date
    expect(await lender.asUser.query(api.loans.get, { loanId })).toMatchObject({ status: "overdue", daysOverdue: 2 });
    const summary = await borrower.asUser.query(api.dashboard.summary, {});
    expect(summary).toMatchObject({ overdueLoans: 1, activeLoans: 0 });
    await lender.asUser.mutation(api.loans.markReturned, { loanId });
  });
});

describe("dashboard scoping", () => {
  it("counts only the caller's own records", async () => {
    const { lender, borrower, toolId } = await setup();
    const stranger = await createUser(t, "stranger");
    await createRequest(borrower, toolId);
    expect(await lender.asUser.query(api.dashboard.summary, {})).toMatchObject({
      activeListings: 1,
      incomingPendingRequests: 1,
      myPendingRequests: 0,
    });
    expect(await borrower.asUser.query(api.dashboard.summary, {})).toMatchObject({
      activeListings: 0,
      incomingPendingRequests: 0,
      myPendingRequests: 1,
    });
    expect(await stranger.asUser.query(api.dashboard.summary, {})).toMatchObject({
      activeListings: 0,
      incomingPendingRequests: 0,
      myPendingRequests: 0,
    });
  });
});
