// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "../../components/shared/empty-state";
import { ErrorBoundary } from "../../components/shared/error-boundary";
import { FilterChips } from "../../components/shared/filter-chips";
import { PaginatedSection } from "../../components/shared/paginated-section";
import { StatusBadge } from "../../components/shared/status-badge";
import { Inbox } from "lucide-react";

afterEach(cleanup);

describe("StatusBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["declined", "Declined"],
    ["cancelled", "Cancelled"],
    ["active", "Active"],
    ["overdue", "Overdue"],
    ["returned", "Returned"],
    ["failed", "Failed"],
    ["sent", "Sent"],
  ])("renders %s as %s", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("falls back to the raw status for an unknown value", () => {
    render(<StatusBadge status="mystery" />);
    expect(screen.getByText("mystery")).toBeTruthy();
  });
});

describe("FilterChips", () => {
  const options = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
  ] as const;

  it("marks the selected chip as pressed and reports a change", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterChips label="Status" options={options} value="all" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Pending" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Pending" }));
    expect(onChange).toHaveBeenCalledWith("pending");
  });

  it("is exposed as a labelled group", () => {
    render(<FilterChips label="Status" options={options} value="all" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Status" })).toBeTruthy();
  });
});

describe("PaginatedSection", () => {
  const base = { getKey: (item: string) => item, renderItem: (item: string) => <span>{item}</span>, empty: <p>Nothing here</p>, loadMore: vi.fn() };

  it("shows a loading state before the first page", () => {
    render(<PaginatedSection {...base} results={[]} status="LoadingFirstPage" />);
    expect(screen.queryByText("Nothing here")).toBeNull();
  });

  it("shows the empty state when there are no results", () => {
    render(<PaginatedSection {...base} results={[]} status="Exhausted" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("renders every item, and asks for more when more can be loaded", async () => {
    const loadMore = vi.fn();
    const user = userEvent.setup();
    render(<PaginatedSection {...base} loadMore={loadMore} results={["one", "two"]} status="CanLoadMore" pageSize={5} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /load more|show more/i }));
    expect(loadMore).toHaveBeenCalledWith(5);
  });

  it("offers no load-more once everything is loaded", () => {
    render(<PaginatedSection {...base} results={["one"]} status="Exhausted" />);
    expect(screen.queryByRole("button", { name: /load more|show more/i })).toBeNull();
  });
});

describe("EmptyState", () => {
  it("shows its title, description and action", () => {
    render(<EmptyState icon={Inbox} title="No tools yet" description="List your first tool." action={<button>Add a tool</button>} />);
    expect(screen.getByText("No tools yet")).toBeTruthy();
    expect(screen.getByText("List your first tool.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a tool" })).toBeTruthy();
  });
});

describe("ErrorBoundary", () => {
  function Boom(): never {
    throw new Error("internal detail that must not be shown");
  }

  it("replaces a crashed subtree with a safe message instead of the stack trace", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    spy.mockRestore();
  });

  it("renders its children when nothing goes wrong", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeTruthy();
  });
});
