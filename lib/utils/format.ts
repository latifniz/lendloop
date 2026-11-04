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

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". `now` is a parameter so it is testable and render-pure. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  return unit(Math.floor(hours / 24), "day");
}
