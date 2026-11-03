/** Loan dates are UTC-midnight timestamps, so they are always rendered in UTC to avoid off-by-one days. */
export function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateRange(startDate: number, endDate: number): string {
  return `${formatDay(startDate)} → ${formatDay(endDate)}`;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function toDateInputValue(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
