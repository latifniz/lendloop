import type { Doc } from "../_generated/dataModel";
import { errors } from "./errors";

export type RequestStatus = Doc<"borrowRequests">["status"];
export type LoanStatus = Doc<"loans">["status"];

/** Single source of truth for allowed transitions; no status is ever set from client input. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["approved", "declined", "cancelled"],
  approved: [],
  declined: [],
  cancelled: [],
};

export const LOAN_TRANSITIONS: Record<LoanStatus, readonly LoanStatus[]> = {
  active: ["returned", "overdue"],
  overdue: ["returned"],
  returned: [],
};

export function canTransition<Status extends string>(
  table: Record<Status, readonly Status[]>,
  from: Status,
  to: Status,
): boolean {
  return table[from].includes(to);
}

export function assertRequestTransition(from: RequestStatus, to: RequestStatus): void {
  if (canTransition(REQUEST_TRANSITIONS, from, to)) return;
  throw errors.invalidState(`This request is already ${from} and cannot become ${to}.`);
}

export function assertLoanTransition(from: LoanStatus, to: LoanStatus): void {
  if (canTransition(LOAN_TRANSITIONS, from, to)) return;
  throw errors.invalidState(
    from === "returned" ? "This loan has already been returned." : `A ${from} loan cannot become ${to}.`,
  );
}

export function isOpenLoan(status: LoanStatus): boolean {
  return status === "active" || status === "overdue";
}
