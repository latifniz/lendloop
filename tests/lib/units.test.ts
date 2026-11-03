import { describe, expect, it } from "vitest";
import { MS_PER_DAY } from "../../lib/constants";
import { getErrorCode, getUserMessage } from "../../lib/utils/app-error";
import { daysOverdue, formatIsoDay, intervalsOverlap, isPastDue, parseIsoDay, validateDateRange } from "../../lib/utils/dates";
import { requestInputSchema, toolInputSchema } from "../../lib/validation/schemas";
import { appError } from "../../convex/lib/errors";
import { LOAN_TRANSITIONS, REQUEST_TRANSITIONS, canTransition } from "../../convex/lib/stateMachine";
import { constantTimeEqual, signWebhook, verifyWebhookSignature } from "../../convex/lib/signing";
import { readOutboundConfig } from "../../convex/lib/env";

const DAY0 = Date.UTC(2026, 10, 3);
const NOW = DAY0 + 12 * 3600 * 1000;

describe("interval overlap rule: existingStart < requestedEnd AND existingEnd > requestedStart", () => {
  const existing = { startDate: 10 * MS_PER_DAY, endDate: 15 * MS_PER_DAY };
  const range = (start: number, end: number) => ({ startDate: start * MS_PER_DAY, endDate: end * MS_PER_DAY });

  it.each([
    ["partial overlap at the start", range(8, 11), true],
    ["partial overlap at the end", range(14, 18), true],
    ["fully contained", range(11, 12), true],
    ["fully containing", range(5, 20), true],
    ["identical", range(10, 15), true],
    ["touching at the end (handover day)", range(15, 18), false],
    ["touching at the start (handover day)", range(5, 10), false],
    ["entirely before", range(1, 5), false],
    ["entirely after", range(20, 25), false],
  ])("%s -> overlap=%s", (_name, requested, expected) => {
    expect(intervalsOverlap(existing, requested)).toBe(expected);
  });
});

describe("date range validation", () => {
  const range = (start: number, end: number) => ({ startDate: DAY0 + start * MS_PER_DAY, endDate: DAY0 + end * MS_PER_DAY });
  it("accepts today as a start date and a 30 day loan", () => {
    expect(validateDateRange(range(0, 30), NOW)).toBeNull();
  });
  it("rejects 31 days, yesterday, reversed and empty ranges", () => {
    expect(validateDateRange(range(0, 31), NOW)).toBe("TOO_LONG");
    expect(validateDateRange(range(-1, 2), NOW)).toBe("START_IN_PAST");
    expect(validateDateRange(range(3, 2), NOW)).toBe("START_NOT_BEFORE_END");
    expect(validateDateRange(range(3, 3), NOW)).toBe("START_NOT_BEFORE_END");
  });
  it("rejects bookings more than a year out", () => {
    expect(validateDateRange(range(366, 368), NOW)).toBe("TOO_FAR_AHEAD");
    expect(validateDateRange(range(365, 367), NOW)).toBeNull();
  });
  it("treats a loan as overdue only after its whole due day has passed", () => {
    const due = DAY0;
    expect(isPastDue(due, due + MS_PER_DAY - 1)).toBe(false);
    expect(isPastDue(due, due + MS_PER_DAY)).toBe(true);
    expect(daysOverdue(due, due + 3 * MS_PER_DAY)).toBe(3);
    expect(daysOverdue(due, due - MS_PER_DAY)).toBe(0);
  });
  it("round-trips ISO days and rejects garbage", () => {
    expect(formatIsoDay(parseIsoDay("2026-11-03")!)).toBe("2026-11-03");
    expect(parseIsoDay("2026-13-45")).toBeNull();
    expect(parseIsoDay("03/11/2026")).toBeNull();
  });
});

describe("input schemas", () => {
  const tool = { name: "Hedge trimmer", category: "Garden", condition: "Good", description: "Petrol hedge trimmer, 60cm blade." };
  it("accepts a valid tool and trims whitespace", () => {
    expect(toolInputSchema.parse({ ...tool, name: "  Hedge trimmer  " }).name).toBe("Hedge trimmer");
  });
  it.each([
    ["short name", { name: "x" }],
    ["long name", { name: "n".repeat(81) }],
    ["multi-line name", { name: "Line\nbreak" }],
    ["unknown category", { category: "Weapons" }],
    ["unknown condition", { condition: "Broken" }],
    ["short description", { description: "tiny" }],
    ["long description", { description: "d".repeat(601) }],
    ["control characters", { description: "bad \u0000 text here" }],
  ])("rejects %s", (_name, overrides) => {
    expect(toolInputSchema.safeParse({ ...tool, ...overrides }).success).toBe(false);
  });
  it("rejects fractional or non-day timestamps and over-long messages", () => {
    expect(requestInputSchema.safeParse({ startDate: DAY0, endDate: DAY0 + MS_PER_DAY }).success).toBe(true);
    expect(requestInputSchema.safeParse({ startDate: DAY0 + 1, endDate: DAY0 + MS_PER_DAY }).success).toBe(false);
    expect(requestInputSchema.safeParse({ startDate: DAY0, endDate: DAY0 + MS_PER_DAY, message: "m".repeat(501) }).success).toBe(false);
  });
});

describe("state machines", () => {
  it("allow exactly the documented transitions", () => {
    expect(canTransition(REQUEST_TRANSITIONS, "pending", "approved")).toBe(true);
    expect(canTransition(REQUEST_TRANSITIONS, "pending", "declined")).toBe(true);
    expect(canTransition(REQUEST_TRANSITIONS, "pending", "cancelled")).toBe(true);
    for (const from of ["approved", "declined", "cancelled"] as const) {
      for (const to of ["pending", "approved", "declined", "cancelled"] as const) {
        expect(canTransition(REQUEST_TRANSITIONS, from, to), `${from}->${to}`).toBe(false);
      }
    }
    expect(canTransition(LOAN_TRANSITIONS, "active", "returned")).toBe(true);
    expect(canTransition(LOAN_TRANSITIONS, "active", "overdue")).toBe(true);
    expect(canTransition(LOAN_TRANSITIONS, "overdue", "returned")).toBe(true);
    expect(canTransition(LOAN_TRANSITIONS, "overdue", "active")).toBe(false);
    expect(canTransition(LOAN_TRANSITIONS, "returned", "active")).toBe(false);
    expect(canTransition(LOAN_TRANSITIONS, "returned", "overdue")).toBe(false);
  });
});

describe("error contract", () => {
  it("surfaces only the safe message of app errors and hides everything else", () => {
    expect(getUserMessage(appError("CONFLICT", "Dates overlap."))).toBe("Dates overlap.");
    expect(getErrorCode(appError("FORBIDDEN", "No."))).toBe("FORBIDDEN");
    expect(getUserMessage(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(getUserMessage({ data: { code: "BOGUS", message: "x" } })).toBe("Something went wrong. Please try again.");
  });
});

describe("webhook signing", () => {
  const base = { secret: "k".repeat(40), timestamp: "1793707200", deliveryId: "d-1", rawBody: '{"a":1}' };
  const verify = (overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}, signature?: string) =>
    signWebhook(base).then((good) =>
      verifyWebhookSignature({ ...base, signature: signature ?? good, nowSeconds: 1793707200, toleranceSeconds: 300, ...overrides }),
    );

  it("produces the documented v1 format and is deterministic", async () => {
    const signature = await signWebhook(base);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(await signWebhook(base)).toBe(signature);
  });
  it("binds the signature to every signed component", async () => {
    const reference = await signWebhook(base);
    expect(await signWebhook({ ...base, rawBody: '{"a":2}' })).not.toBe(reference);
    expect(await signWebhook({ ...base, timestamp: "1793707201" })).not.toBe(reference);
    expect(await signWebhook({ ...base, deliveryId: "d-2" })).not.toBe(reference);
    expect(await signWebhook({ ...base, secret: "j".repeat(40) })).not.toBe(reference);
  });
  it("verifies fresh, rejects stale, mismatched and malformed", async () => {
    expect(await verify()).toBe("ok");
    expect(await verify({ nowSeconds: 1793707200 + 301 })).toBe("stale");
    expect(await verify({ rawBody: '{"a":3}' })).toBe("mismatch");
    expect(await verify({}, "v1=zz")).toBe("malformed");
  });
  it("compares secrets in constant time semantics (equal/unequal/length differences)", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abd")).toBe(false);
    expect(await constantTimeEqual("abc", "abcd")).toBe(false);
    expect(await constantTimeEqual("", "x")).toBe(false);
  });
});

describe("integration environment validation", () => {
  const good = { N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/x", CONVEX_N8N_WEBHOOK_SECRET: "s".repeat(32), APP_URL: "https://app.example.com/" };
  it("accepts https and localhost http, normalises the app url", () => {
    expect(readOutboundConfig(good)).toMatchObject({ ok: true, value: { appUrl: "https://app.example.com" } });
    expect(readOutboundConfig({ ...good, N8N_WEBHOOK_URL: "http://localhost:5678/webhook/x" }).ok).toBe(true);
  });
  it("rejects plain http to remote hosts, short secrets and missing values without echoing secrets", () => {
    expect(readOutboundConfig({ ...good, N8N_WEBHOOK_URL: "http://n8n.example.com/x" }).ok).toBe(false);
    const weak = readOutboundConfig({ ...good, CONVEX_N8N_WEBHOOK_SECRET: "tooshort" });
    expect(weak.ok).toBe(false);
    expect(JSON.stringify(weak)).not.toContain("tooshort");
    expect(readOutboundConfig({}).ok).toBe(false);
  });
});
