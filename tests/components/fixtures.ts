import type { Id } from "../../convex/_generated/dataModel";
import type { LoanRow, RequestRow } from "../../types";

const DAY = 86_400_000;
export const START = Date.UTC(2026, 10, 10);

export const requestRow = (overrides: Partial<RequestRow> = {}): RequestRow =>
  ({
    _id: "request1" as Id<"borrowRequests">,
    toolName: "Cordless drill",
    counterpartName: "Ben Borrower",
    counterpartIsTrusted: false,
    status: "pending",
    startDate: START,
    endDate: START + 2 * DAY,
    message: "Weekend project",
    createdAt: START - 5 * DAY,
    ...overrides,
  }) as RequestRow;

export const loanRow = (overrides: Partial<LoanRow> = {}): LoanRow =>
  ({
    _id: "loan1" as Id<"loans">,
    toolName: "Cordless drill",
    lenderName: "Lena Lender",
    borrowerName: "Ben Borrower",
    status: "active",
    startDate: START,
    endDate: START + 2 * DAY,
    returnedAt: null,
    daysOverdue: 0,
    viewerRole: "lender",
    ...overrides,
  }) as LoanRow;
