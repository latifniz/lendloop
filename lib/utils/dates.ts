import { MS_PER_DAY, REQUEST_LIMITS } from "../constants";

export function startOfUtcDay(timestamp: number): number {
  return Math.floor(timestamp / MS_PER_DAY) * MS_PER_DAY;
}

/** Half-open interval overlap: existingStart < requestedEnd AND existingEnd > requestedStart. */
export function intervalsOverlap(
  existing: { startDate: number; endDate: number },
  requested: { startDate: number; endDate: number },
): boolean {
  return existing.startDate < requested.endDate && existing.endDate > requested.startDate;
}

export type DateRangeError =
  | "START_NOT_BEFORE_END"
  | "START_IN_PAST"
  | "TOO_LONG"
  | "TOO_FAR_AHEAD";

export function validateDateRange(
  range: { startDate: number; endDate: number },
  now: number,
): DateRangeError | null {
  if (range.startDate >= range.endDate) return "START_NOT_BEFORE_END";
  if (range.startDate < startOfUtcDay(now)) return "START_IN_PAST";
  if ((range.endDate - range.startDate) / MS_PER_DAY > REQUEST_LIMITS.maxLoanDays) return "TOO_LONG";
  if ((range.startDate - startOfUtcDay(now)) / MS_PER_DAY > REQUEST_LIMITS.maxLeadDays) return "TOO_FAR_AHEAD";
  return null;
}

export const DATE_RANGE_MESSAGES: Record<DateRangeError, string> = {
  START_NOT_BEFORE_END: "The start date must be before the end date.",
  START_IN_PAST: "The start date cannot be in the past.",
  TOO_LONG: `Loans can last at most ${REQUEST_LIMITS.maxLoanDays} days.`,
  TOO_FAR_AHEAD: `Requests can be made at most ${REQUEST_LIMITS.maxLeadDays} days ahead.`,
};

/**
 * A loan is overdue once its whole due day (the UTC day that starts at endDate)
 * has passed. Handover on the due day itself is still on time.
 */
export function isPastDue(endDate: number, now: number): boolean {
  return now >= endDate + MS_PER_DAY;
}

export function daysOverdue(endDate: number, now: number): number {
  return Math.max(0, Math.floor((now - endDate) / MS_PER_DAY));
}

export function formatIsoDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Converts an <input type="date"> value (YYYY-MM-DD) into a UTC-midnight timestamp. */
export function parseIsoDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}
