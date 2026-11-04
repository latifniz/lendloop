export const TOOL_CATEGORIES = [
  "Power tools",
  "Garden",
  "Kitchen",
  "Camping",
  "Automotive",
  "Cleaning",
  "Other",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_CONDITIONS = ["New", "Like new", "Good", "Fair", "Worn"] as const;
export type ToolCondition = (typeof TOOL_CONDITIONS)[number];

export const TOOL_LIMITS = {
  nameMax: 80,
  descriptionMax: 600,
} as const;

export const REQUEST_LIMITS = {
  messageMax: 500,
  maxLoanDays: 30,
  maxLeadDays: 365,
  /** Caps pending requests per borrower so one account cannot flood lenders. */
  maxPendingPerBorrower: 20,
} as const;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const AUTOMATION = {
  /** Total delivery attempts (first try + retries) before an event stays failed. */
  maxAttempts: 5,
  /** Timestamp tolerance for signed webhooks, in seconds (both directions of clock skew). */
  signatureToleranceSeconds: 300,
  dispatchTimeoutMs: 10_000,
  /** How long Convex waits for n8n to report the notification outcome. */
  ackTimeoutMs: 5 * 60 * 1000,
  /** How long one n8n execution may hold an event before another claim is allowed. */
  claimLeaseMs: 10 * 60 * 1000,
  baseRetryDelayMs: 30_000,
  /** The watchdog waits this long past an event's own timer before treating its scheduled job as lost. */
  stuckGraceMs: 10 * 60 * 1000,
  maxRequestBodyBytes: 32 * 1024,
  /** Per-minute budget for authenticated n8n -> Convex calls. */
  n8nRateLimitPerMinute: 600,
} as const;
