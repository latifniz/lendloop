// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loanRow, requestRow } from "./fixtures";

const calls: Array<{ fn: string; args: unknown }> = [];
vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ fn: getFunctionName(reference), args });
    return Promise.resolve(null);
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LoanCard } from "../../components/loans/loan-card";
import { reminderText } from "../../components/loans/reminder-note";
import { RequestCard } from "../../components/requests/request-card";

beforeEach(() => {
  calls.length = 0;
});
afterEach(cleanup);

const button = (name: string) => screen.queryByRole("button", { name });

describe("RequestCard", () => {
  it("offers the lender Approve and Decline on a pending request, and no Cancel", () => {
    render(<RequestCard request={requestRow()} perspective="lender" />);
    expect(button("Approve")).toBeTruthy();
    expect(button("Decline")).toBeTruthy();
    expect(button("Cancel request")).toBeNull();
    expect(screen.getByText(/Borrower: Ben Borrower/)).toBeTruthy();
  });

  it("offers the borrower only Cancel, and names the lender", () => {
    render(<RequestCard request={requestRow({ counterpartName: "Lena Lender" })} perspective="borrower" />);
    expect(button("Cancel request")).toBeTruthy();
    expect(button("Approve")).toBeNull();
    expect(screen.getByText(/Lender: Lena Lender/)).toBeTruthy();
  });

  it.each(["approved", "declined", "cancelled"] as const)("offers no actions once a request is %s", (status) => {
    render(<RequestCard request={requestRow({ status })} perspective="lender" />);
    expect(button("Approve")).toBeNull();
    expect(button("Decline")).toBeNull();
    expect(button("Cancel request")).toBeNull();
  });

  it("asks for confirmation, then approves exactly once with the request id", async () => {
    const user = userEvent.setup();
    render(<RequestCard request={requestRow()} perspective="lender" />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(calls).toHaveLength(0);
    expect(within(dialog).getByText(/re-check that those dates are still free/i)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(calls).toEqual([{ fn: "requests:approve", args: { requestId: "request1" } }]);
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    render(<RequestCard request={requestRow()} perspective="lender" />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(calls).toHaveLength(0);
  });

  it("declines and cancels through their own mutations", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RequestCard request={requestRow()} perspective="lender" />);
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Decline" }));
    unmount();
    render(<RequestCard request={requestRow()} perspective="borrower" />);
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel request" }));
    expect(calls.map((call) => call.fn)).toEqual(["requests:decline", "requests:cancel"]);
  });

  it("shows the borrower's note and a trusted badge", () => {
    render(<RequestCard request={requestRow({ counterpartIsTrusted: true })} perspective="lender" />);
    expect(screen.getByText(/Weekend project/)).toBeTruthy();
    expect(screen.getByText("Trusted")).toBeTruthy();
  });

  it("omits the note block when there is no message", () => {
    render(<RequestCard request={requestRow({ message: undefined })} perspective="lender" />);
    expect(screen.queryByText(/Message:/)).toBeNull();
  });
});

describe("LoanCard", () => {
  it("lets only the lender mark an open loan returned, via the mutation", async () => {
    const user = userEvent.setup();
    render(<LoanCard loan={loanRow({ viewerRole: "lender" })} />);
    await user.click(screen.getByRole("button", { name: "Mark as returned" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Mark as returned" }));
    expect(calls).toEqual([{ fn: "loans:markReturned", args: { loanId: "loan1" } }]);
  });

  it("tells the borrower to return the tool, with no button", () => {
    render(<LoanCard loan={loanRow({ viewerRole: "borrower" })} />);
    expect(button("Mark as returned")).toBeNull();
    expect(screen.getByText(/Return the tool to Lena Lender/)).toBeTruthy();
    expect(screen.getByText(/Borrowed from Lena Lender/)).toBeTruthy();
  });

  it("shows how long a loan is overdue, singular and plural", () => {
    const { unmount } = render(<LoanCard loan={loanRow({ status: "overdue", daysOverdue: 1 })} />);
    expect(screen.getByRole("status").textContent).toContain("1 day overdue");
    unmount();
    render(<LoanCard loan={loanRow({ status: "overdue", daysOverdue: 3 })} />);
    expect(screen.getByRole("status").textContent).toContain("3 days overdue");
  });

  it("says 'Past its due date' on the due day itself", () => {
    render(<LoanCard loan={loanRow({ status: "overdue", daysOverdue: 0 })} />);
    expect(screen.getByRole("status").textContent).toContain("Past its due date");
  });

  it("shows the return time and no actions for a returned loan", () => {
    render(<LoanCard loan={loanRow({ status: "returned", returnedAt: Date.UTC(2026, 10, 12, 9, 30) })} />);
    expect(screen.getByText("Returned", { selector: "dt" })).toBeTruthy();
    expect(button("Mark as returned")).toBeNull();
  });
});

describe("loan reminder activity", () => {
  const DAY = 86_400_000;

  it("shows 'Reminder sent 2 days ago' on the loan", () => {
    render(<LoanCard loan={loanRow({ status: "overdue", daysOverdue: 2, lastReminder: { status: "sent", at: Date.now() - 2 * DAY } })} />);
    expect(screen.getByText("Reminder sent 2 days ago")).toBeTruthy();
  });

  it("shows nothing when no reminder has been sent", () => {
    render(<LoanCard loan={loanRow({ lastReminder: null })} />);
    expect(screen.queryByText(/reminder/i)).toBeNull();
  });

  it.each([
    [{ status: "sent", at: 0 }, 2 * DAY, "Reminder sent 2 days ago"],
    [{ status: "pending", at: 0 }, 0, "Reminder queued"],
    [{ status: "processing", at: 0 }, 0, "Reminder queued"],
    [{ status: "failed", at: 0 }, 0, "Reminder not delivered yet; it will be retried"],
    [{ status: "skipped", at: 0 }, 0, null],
    [null, 0, null],
  ] as const)("describes %j as %s", (reminder, now, expected) => {
    expect(reminderText(reminder as Parameters<typeof reminderText>[0], now)).toBe(expected);
  });
});
