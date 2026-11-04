// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

// A plain recorder instead of vi.fn(): vitest's mock tracker attaches its own handler to rejected promises,
// which reports an unhandled rejection even though the component handles the error.
const calls: unknown[] = [];
let outcome: () => Promise<unknown> = () => Promise.resolve("request1");
const mutate = (args: unknown) => {
  calls.push(args);
  return outcome();
};
vi.mock("convex/react", () => ({ useMutation: () => mutate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BorrowRequestDialog } from "../../components/tools/borrow-request-dialog";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  render(<BorrowRequestDialog toolId={"tool1" as Id<"tools">} toolName="Cordless drill" trigger={<button>Request to borrow</button>} />);
  await user.click(screen.getByRole("button", { name: "Request to borrow" }));
  await screen.findByRole("dialog");
}
const dates = async (user: ReturnType<typeof userEvent.setup>, from: string, to: string) => {
  await user.type(screen.getByLabelText("From"), from);
  await user.type(screen.getByLabelText(/return by/i), to);
};

beforeEach(() => {
  calls.length = 0;
  outcome = () => Promise.resolve("request1");
});
afterEach(cleanup);

describe("BorrowRequestDialog", () => {
  it("names the tool being borrowed", async () => {
    await openDialog(userEvent.setup());
    expect(screen.getByRole("heading", { name: /borrow cordless drill/i })).toBeTruthy();
  });

  it("asks for both dates and sends nothing when they are missing", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Choose a start date")).toBeTruthy();
    expect(screen.getByText("Choose an end date")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("refuses an end date before the start date", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(5), day(2));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByLabelText(/return by/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a loan longer than 30 days", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(2), day(40));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText(/30 days/i)).toBeTruthy();
  });

  it("sends UTC-midnight timestamps and the trimmed message, then closes", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(2), day(5));
    await user.type(screen.getByLabelText(/message/i), "  Weekend project  ");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ toolId: "tool1", startDate: utc(day(2)), endDate: utc(day(5)), message: "Weekend project" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("omits an empty message", async () => {
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(2), day(3));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ message: undefined });
  });

  it("keeps the dialog open and shows the server's user-safe message when the request is refused", async () => {
    outcome = () => Promise.reject({ data: { code: "CONFLICT", message: "You already have a pending request for these dates." } });
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(2), day(3));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You already have a pending request for these dates.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows a generic message, never internals, for an unexpected failure", async () => {
    outcome = () => Promise.reject("Server Error: stack trace with internals");
    const user = userEvent.setup();
    await openDialog(user);
    await dates(user, day(2), day(3));
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
    expect(screen.queryByText(/stack trace/i)).toBeNull();
  });
});
