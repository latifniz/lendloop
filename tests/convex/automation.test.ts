import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOMATION } from "../../lib/constants";
import { api, internal } from "../../convex/_generated/api";
import { signWebhook, verifyWebhookSignature } from "../../convex/lib/signing";
import {
  FIXED_NOW,
  PAGE,
  createRequest,
  createTestConvex,
  createTool,
  createUser,
  dayOffset,
  makeAdmin,
  useFixedClock,
  type TestConvex,
} from "../helpers";

const WEBHOOK_SECRET = "w".repeat(40);
const API_SECRET = "a".repeat(40);
const ENV = {
  N8N_WEBHOOK_URL: "http://localhost:5678/webhook/lendloop/request-events",
  CONVEX_N8N_WEBHOOK_SECRET: WEBHOOK_SECRET,
  N8N_CONVEX_API_SECRET: API_SECRET,
  APP_URL: "https://lendloop.example.test",
};

let t: TestConvex;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  useFixedClock();
  Object.assign(process.env, ENV);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  t = createTestConvex();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const key of Object.keys(ENV)) delete process.env[key];
  delete process.env.N8N_CONVEX_SIGNING_SECRET;
});

const authHeaders = { authorization: `Bearer ${API_SECRET}`, "content-type": "application/json" };
const post = (path: string, body: unknown, headers: Record<string, string> = authHeaders) =>
  t.fetch(path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

async function allEvents() {
  return await t.run((ctx) => ctx.db.query("automationEvents").collect());
}

async function drainScheduler() {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/** Runs the immediately-scheduled dispatch job without letting later retry/timeout jobs fire. */
async function dispatchOnce() {
  await t.finishInProgressScheduledFunctions();
  await vi.advanceTimersByTimeAsync(1);
  await t.finishInProgressScheduledFunctions();
}

async function setup() {
  const lender = await createUser(t, "lender", "Lena Lender");
  const borrower = await createUser(t, "borrower", "Ben Borrower");
  const toolId = await createTool(lender);
  return { lender, borrower, toolId };
}

describe("outbox events", () => {
  it("records a pending event for the lender when a request is created, with a deterministic key", async () => {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    const [event] = await allEvents();
    expect(event).toMatchObject({
      eventKey: `request.created:${requestId}`,
      eventType: "request.created",
      status: "pending",
      attempts: 0,
      recipientUserId: lender.id,
    });
  });

  it("emits one event per status change addressed to the right person", async () => {
    const { lender, borrower, toolId } = await setup();
    const approved = await createRequest(borrower, toolId, 2, 3);
    const declined = await createRequest(borrower, toolId, 5, 6);
    const cancelled = await createRequest(borrower, toolId, 8, 9);
    await lender.asUser.mutation(api.requests.approve, { requestId: approved });
    await lender.asUser.mutation(api.requests.decline, { requestId: declined });
    await borrower.asUser.mutation(api.requests.cancel, { requestId: cancelled });

    const events = new Map((await allEvents()).map((event) => [event.eventKey, event]));
    expect(events.get(`request.approved:${approved}`)?.recipientUserId).toBe(borrower.id);
    expect(events.get(`request.declined:${declined}`)?.recipientUserId).toBe(borrower.id);
    expect(events.get(`request.cancelled:${cancelled}`)?.recipientUserId).toBe(lender.id);
    expect(events.size).toBe(6);
  });

  it("does not create an event when the business mutation fails (transactional outbox)", async () => {
    const { lender, toolId } = await setup();
    await expect(createRequest(lender, toolId)).rejects.toBeTruthy();
    expect(await allEvents()).toHaveLength(0);
  });
});

describe("dispatch to n8n", () => {
  it("sends a verifiable signed payload containing only the recipient's data", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await dispatchOnce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(ENV.N8N_WEBHOOK_URL);
    const headers = init?.headers as Record<string, string>;
    const body = String(init?.body);

    expect(
      await verifyWebhookSignature({
        secret: WEBHOOK_SECRET,
        timestamp: headers["x-lendloop-timestamp"] ?? "",
        deliveryId: headers["x-lendloop-delivery-id"] ?? "",
        rawBody: body,
        signature: headers["x-lendloop-signature"] ?? "",
        nowSeconds: Math.floor(FIXED_NOW / 1000),
        toleranceSeconds: AUTOMATION.signatureToleranceSeconds,
      }),
    ).toBe("ok");

    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      eventType: "request.created",
      recipient: { role: "lender", name: "Lena Lender", email: "lender@example.test" },
      counterpartName: "Ben Borrower",
      tool: { name: "Cordless drill" },
      request: { status: "pending", message: "Weekend project" },
      actionUrl: "https://lendloop.example.test/requests/incoming",
    });
    // Data minimisation: the borrower's email, Clerk ids and Convex ids never leave Convex.
    expect(body).not.toContain("borrower@example.test");
    expect(body).not.toContain("user_");
    expect(body).not.toMatch(/"_id"|"clerkId"|"role":"admin"/);
    expect(JSON.stringify(init?.headers)).not.toContain(WEBHOOK_SECRET);
  });

  it("keeps the event 'processing' after n8n accepts the webhook, and only marks it 'sent' on write-back", async () => {
    const { borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await dispatchOnce();

    let [event] = await allEvents();
    expect(event?.status).toBe("processing");
    expect(event?.sentAt).toBeUndefined();

    const response = await post("/n8n/events/result", { eventId: `request.created:${requestId}`, outcome: "sent" });
    expect(response.status).toBe(200);
    [event] = await allEvents();
    expect(event).toMatchObject({ status: "sent" });
    expect(event?.sentAt).toBeTypeOf("number");
  });

  it("records a failed event and retries with backoff up to the attempt limit when n8n is unreachable", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await drainScheduler();

    const [event] = await allEvents();
    expect(fetchMock).toHaveBeenCalledTimes(AUTOMATION.maxAttempts);
    expect(event).toMatchObject({ status: "failed", errorCode: "NETWORK_ERROR", attempts: AUTOMATION.maxAttempts });
  });

  it("retries on 5xx but treats other 4xx responses as permanent", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValue(new Response("{}", { status: 202 }));
    await dispatchOnce();
    let [event] = await allEvents();
    expect(event).toMatchObject({ status: "failed", errorCode: "N8N_HTTP_503", attempts: 1 });
    await vi.advanceTimersByTimeAsync(AUTOMATION.baseRetryDelayMs + 1000);
    await t.finishInProgressScheduledFunctions();
    [event] = await allEvents();
    expect(event).toMatchObject({ status: "processing", attempts: 2 });

    // A permanent rejection is not retried.
    const second = await createRequest(borrower, await createTool((await createUser(t, "other")), { name: "Rake" }), 2, 3);
    expect(second).toBeTruthy();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
    const rejected = (await allEvents()).find((e) => e.errorCode === "N8N_HTTP_401");
    expect(rejected).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("fails closed without calling n8n when the integration is misconfigured", async () => {
    const { borrower, toolId } = await setup();
    process.env.N8N_WEBHOOK_URL = "http://evil.example.com/hook"; // plain http to a non-local host
    await createRequest(borrower, toolId);
    await drainScheduler();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await allEvents())[0]).toMatchObject({ status: "failed", errorCode: "CONFIG_INVALID" });
  });

  it("marks the event failed (and retries) when n8n accepts but never reports back", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await drainScheduler();
    const [event] = await allEvents();
    expect(event).toMatchObject({ status: "failed", errorCode: "ACK_TIMEOUT", attempts: AUTOMATION.maxAttempts });
  });

  it("records NO_RECIPIENT_EMAIL instead of sending when the recipient has no email", async () => {
    const lender = await createUser(t, "lender");
    await t.run(async (ctx) => ctx.db.patch(lender.id, { email: undefined }));
    const borrower = await createUser(t, "borrower");
    await createRequest(borrower, await createTool(lender));
    await drainScheduler();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await allEvents())[0]).toMatchObject({ status: "failed", errorCode: "NO_RECIPIENT_EMAIL" });
  });
});

describe("n8n -> Convex endpoint security", () => {
  it.each([
    ["no Authorization header", {}],
    ["wrong secret", { authorization: `Bearer ${"x".repeat(40)}` }],
    ["wrong scheme", { authorization: `Basic ${API_SECRET}` }],
    ["empty bearer", { authorization: "Bearer " }],
  ])("rejects %s with 401 before touching data", async (_name, headers) => {
    const response = await post("/n8n/overdue/run", {}, headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await allEvents()).toHaveLength(0);
  });

  it("is disabled (503) rather than open when the API secret is not configured", async () => {
    delete process.env.N8N_CONVEX_API_SECRET;
    expect((await post("/n8n/overdue/run", {})).status).toBe(503);
  });

  it("rejects the HMAC webhook secret as an API credential (separate credentials per direction)", async () => {
    const response = await post("/n8n/overdue/run", {}, { authorization: `Bearer ${WEBHOOK_SECRET}` });
    expect(response.status).toBe(401);
  });

  it("validates input: bad JSON, unknown fields, malformed keys, oversized bodies", async () => {
    expect((await post("/n8n/events/claim", "{not json")).status).toBe(400);
    expect((await post("/n8n/events/claim", { eventId: "ok:1", extra: true })).status).toBe(400);
    expect((await post("/n8n/events/claim", { eventId: "bad key with spaces" })).status).toBe(400);
    expect((await post("/n8n/events/result", { eventId: "ok:1", outcome: "maybe" })).status).toBe(400);
    expect((await post("/n8n/events/result", { eventId: "ok:1", outcome: "failed", errorCode: "lower case" })).status).toBe(400);
    const huge = JSON.stringify({ eventId: "a".repeat(AUTOMATION.maxRequestBodyBytes + 10) });
    expect((await post("/n8n/events/claim", huge)).status).toBe(413);
  });

  it("never leaks internals in error responses", async () => {
    const response = await post("/n8n/events/claim", { eventId: "ok:1", extra: 1 });
    const text = await response.text();
    expect(text).not.toMatch(/stack|convex|at \w+ \(/i);
  });

  it("enforces the rate limit window", async () => {
    const consume = () => t.mutation(internal.rateLimit.consume, { key: "test", limit: 3, windowMs: 60_000 });
    expect((await consume()).allowed).toBe(true);
    expect((await consume()).allowed).toBe(true);
    expect((await consume()).allowed).toBe(true);
    expect(await consume()).toMatchObject({ allowed: false });
    await vi.advanceTimersByTimeAsync(61_000);
    expect((await consume()).allowed).toBe(true);
  });
});

describe("claim and write-back idempotency", () => {
  async function inFlightEvent() {
    const { borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await dispatchOnce();
    return `request.created:${requestId}`;
  }

  it("grants a claim once; duplicate deliveries and replays of the same deliveryId are refused", async () => {
    const eventId = await inFlightEvent();
    expect(await (await post("/n8n/events/claim", { eventId, deliveryId: "delivery-1" })).json()).toEqual({ proceed: true });
    expect(await (await post("/n8n/events/claim", { eventId, deliveryId: "delivery-1" })).json()).toMatchObject({
      proceed: false,
      reason: "replayed_delivery",
    });
    expect(await (await post("/n8n/events/claim", { eventId, deliveryId: "delivery-2" })).json()).toMatchObject({
      proceed: false,
      reason: "claim_in_progress",
    });
  });

  it("refuses to claim events that were never dispatched, unknown events and already-sent events", async () => {
    const { borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId);
    const key = `request.created:${requestId}`;
    expect(await (await post("/n8n/events/claim", { eventId: key })).json()).toMatchObject({ proceed: false, reason: "not_dispatched" });
    expect(await (await post("/n8n/events/claim", { eventId: "request.created:nope" })).json()).toMatchObject({
      proceed: false,
      reason: "unknown_event",
    });
  });

  it("applies a repeated 'sent' write-back exactly once", async () => {
    const eventId = await inFlightEvent();
    const first = await (await post("/n8n/events/result", { eventId, outcome: "sent" })).json();
    const sentAt = (await allEvents())[0]?.sentAt;
    vi.setSystemTime(FIXED_NOW + 60_000);
    const second = await (await post("/n8n/events/result", { eventId, outcome: "sent" })).json();
    expect(first).toEqual({ status: "sent", duplicate: false });
    expect(second).toEqual({ status: "sent", duplicate: true });
    expect(await allEvents()).toHaveLength(1);
    expect((await allEvents())[0]?.sentAt).toBe(sentAt);
  });

  it("never downgrades a sent event when a late failure report arrives", async () => {
    const eventId = await inFlightEvent();
    await post("/n8n/events/result", { eventId, outcome: "sent" });
    const late = await (await post("/n8n/events/result", { eventId, outcome: "failed", errorCode: "SMTP_TIMEOUT" })).json();
    expect(late).toMatchObject({ status: "sent", duplicate: true });
  });

  it("records failed notifications with a coarse error code and schedules a retry when retryable", async () => {
    const eventId = await inFlightEvent();
    const response = await post("/n8n/events/result", { eventId, outcome: "failed", errorCode: "SMTP_TIMEOUT", retryable: true });
    expect(await response.json()).toEqual({ status: "failed", duplicate: false });
    const [event] = await allEvents();
    expect(event).toMatchObject({ status: "failed", errorCode: "SMTP_TIMEOUT", attempts: 1 });

    // The same failure reported again is a no-op.
    expect(await (await post("/n8n/events/result", { eventId, outcome: "failed", errorCode: "SMTP_TIMEOUT" })).json()).toMatchObject({
      duplicate: true,
    });
    // The retry goes out as a fresh, separately signed delivery.
    await vi.advanceTimersByTimeAsync(AUTOMATION.baseRetryDelayMs + 1000);
    await t.finishInProgressScheduledFunctions();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await allEvents())[0]).toMatchObject({ status: "processing", attempts: 2 });
    const deliveryIds = fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["x-lendloop-delivery-id"]);
    expect(new Set(deliveryIds).size).toBe(2);
  });

  it("answers unknown events without creating records", async () => {
    const response = await post("/n8n/events/result", { eventId: "request.created:ghost", outcome: "sent" });
    expect(await response.json()).toEqual({ status: "unknown", duplicate: false });
    expect(await allEvents()).toHaveLength(0);
  });
});

describe("daily overdue reminders", () => {
  async function overdueLoan() {
    const { lender, borrower, toolId } = await setup();
    const requestId = await createRequest(borrower, toolId, 1, 2);
    const loanId = await lender.asUser.mutation(api.requests.approve, { requestId });
    return { lender, borrower, loanId };
  }
  const runSweep = async () => await (await post("/n8n/overdue/run", {})).json();
  const reminderEvents = async () => (await allEvents()).filter((event) => event.eventType === "loan.overdue_reminder");

  it("does not remind about loans that are not yet past their due day", async () => {
    await overdueLoan();
    vi.setSystemTime(dayOffset(2) + 6 * 3600 * 1000);
    expect((await runSweep()).reminders).toEqual([]);
  });

  it("returns only the data needed for the reminder and flips active loans to overdue", async () => {
    const { loanId } = await overdueLoan();
    vi.setSystemTime(dayOffset(4) + 3600 * 1000);
    const result = await runSweep();
    expect(result.reminders).toHaveLength(1);
    expect(result.reminders[0]).toMatchObject({
      borrower: { name: "Ben Borrower", email: "borrower@example.test" },
      lenderName: "Lena Lender",
      toolName: "Cordless drill",
      dueDate: "2026-11-05",
      daysOverdue: 2,
      eventKey: `overdue-reminder:${loanId}:2026-11-07`,
    });
    expect(Object.keys(result.reminders[0]).sort()).toEqual(
      ["actionUrl", "borrower", "correlationId", "daysOverdue", "dueDate", "eventKey", "lenderName", "toolName"].sort(),
    );
    expect(JSON.stringify(result)).not.toContain("lender@example.test");
    const stored = await t.run((ctx) => ctx.db.get(loanId));
    expect(stored?.status).toBe("overdue");
  });

  it("is idempotent: repeating the sweep or the write-back never creates duplicate records", async () => {
    const { loanId } = await overdueLoan();
    vi.setSystemTime(dayOffset(4));
    const key = `overdue-reminder:${loanId}:2026-11-07`;
    await runSweep();
    await runSweep();
    expect(await reminderEvents()).toHaveLength(1);

    expect(await (await post("/n8n/events/claim", { eventId: key })).json()).toEqual({ proceed: true });
    await post("/n8n/events/result", { eventId: key, outcome: "sent" });
    await post("/n8n/events/result", { eventId: key, outcome: "sent" });
    expect(await reminderEvents()).toHaveLength(1);
    expect((await reminderEvents())[0]).toMatchObject({ status: "sent", attempts: 1 });

    // Once sent, the same day's sweep omits it; and a re-claim is refused.
    expect((await runSweep()).reminders).toEqual([]);
    expect(await (await post("/n8n/events/claim", { eventId: key })).json()).toMatchObject({ proceed: false, reason: "already_handled" });
  });

  it("sends a new reminder on the next day (key includes the date) while the loan stays overdue", async () => {
    const { loanId } = await overdueLoan();
    vi.setSystemTime(dayOffset(4));
    const first = (await runSweep()).reminders[0].eventKey;
    await post("/n8n/events/claim", { eventId: first });
    await post("/n8n/events/result", { eventId: first, outcome: "sent" });
    vi.setSystemTime(dayOffset(5));
    const next = (await runSweep()).reminders[0].eventKey;
    expect(first).toBe(`overdue-reminder:${loanId}:2026-11-07`);
    expect(next).toBe(`overdue-reminder:${loanId}:2026-11-08`);
  });

  it("does not remind about returned loans, and skips a reminder whose loan was returned after listing", async () => {
    const { lender, loanId } = await overdueLoan();
    vi.setSystemTime(dayOffset(4));
    const key = (await runSweep()).reminders[0].eventKey;
    await lender.asUser.mutation(api.loans.markReturned, { loanId });

    expect((await runSweep()).reminders).toEqual([]);
    expect(await (await post("/n8n/events/claim", { eventId: key })).json()).toMatchObject({ proceed: false, reason: "loan_returned" });
    expect((await reminderEvents())[0]).toMatchObject({ status: "skipped", errorCode: "LOAN_RETURNED" });
  });

  it("keeps a failed reminder retryable within the day but stops after the attempt limit", async () => {
    const { loanId } = await overdueLoan();
    vi.setSystemTime(dayOffset(4));
    const key = `overdue-reminder:${loanId}:2026-11-07`;
    for (let attempt = 1; attempt <= AUTOMATION.maxAttempts; attempt += 1) {
      expect((await runSweep()).reminders).toHaveLength(1);
      await post("/n8n/events/claim", { eventId: key });
      vi.setSystemTime(Date.now() + 1000);
      await post("/n8n/events/result", { eventId: key, outcome: "failed", errorCode: `SMTP_FAIL_${attempt}` });
    }
    expect((await runSweep()).reminders).toEqual([]);
  });

  it("shows the recipient their own reminder activity and nobody else's", async () => {
    const { borrower, lender } = await overdueLoan();
    vi.setSystemTime(dayOffset(4));
    await runSweep();
    const activity = await borrower.asUser.query(api.dashboard.recentActivity, {});
    expect(activity.filter((event) => event.eventType === "loan.overdue_reminder")).toHaveLength(1);
    expect(await lender.asUser.query(api.dashboard.recentActivity, {})).not.toContainEqual(
      expect.objectContaining({ eventType: "loan.overdue_reminder" }),
    );
  });
});

describe("workflow error reporting", () => {
  const body = { workflowName: "LendLoop - Request notifications", executionId: "42", errorCategory: "TIMEOUT" };

  it("stores a sanitised failure record and ignores duplicate reports for the same execution", async () => {
    expect(await (await post("/n8n/errors", body)).json()).toEqual({ duplicate: false });
    expect(await (await post("/n8n/errors", body)).json()).toEqual({ duplicate: true });
    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "workflow.error",
      status: "failed",
      errorCode: "TIMEOUT",
      workflowName: body.workflowName,
      executionId: "42",
    });
  });

  it("preserves a supplied correlation id and rejects free-text error details", async () => {
    const correlationId = "6f1c1d0e-9a1f-4c55-8f7e-0d4f3f1b2a11";
    await post("/n8n/errors", { ...body, correlationId });
    expect((await allEvents())[0]?.correlationId).toBe(correlationId);
    expect((await post("/n8n/errors", { ...body, executionId: "43", message: "SMTP password=hunter2" })).status).toBe(400);
    expect((await post("/n8n/errors", { ...body, executionId: "44", errorCategory: "some free text" })).status).toBe(400);
  });

  it("surfaces failures to admins and lets them retry failed notifications", async () => {
    const admin = await createUser(t, "admin");
    await makeAdmin(t, admin);
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await drainScheduler();

    const failed = await admin.asUser.query(api.automation.listRecent, { status: "failed", paginationOpts: PAGE });
    expect(failed.page).toHaveLength(1);
    expect(failed.page[0]).toMatchObject({ errorCode: "N8N_HTTP_401", canRetry: true });
    expect(JSON.stringify(failed)).not.toContain("example.test");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await admin.asUser.mutation(api.automation.retryFailed, { eventId: failed.page[0]!._id });
    await dispatchOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let normal users retry events", async () => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    const [event] = await allEvents();
    await expect(
      borrower.asUser.mutation(api.automation.retryFailed, { eventId: event!._id }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });
});

describe("stuck-event watchdog", () => {
  const sweep = () => t.mutation(internal.automation.sweepStuck, {});
  const makeStuck = async (patch: Partial<{ status: "pending" | "processing" | "failed"; attempts: number; lastAttemptAt: number }>, ageMs: number) => {
    const { borrower, toolId } = await setup();
    await createRequest(borrower, toolId);
    const [event] = await allEvents();
    await t.run((ctx) => ctx.db.patch(event!._id, { ...patch, updatedAt: FIXED_NOW - ageMs }));
    return event!._id;
  };
  const status = async (id: Awaited<ReturnType<typeof makeStuck>>) => (await t.run((ctx) => ctx.db.get(id)))!;

  it("leaves a fresh pending event alone", async () => {
    await makeStuck({ status: "pending" }, 60_000);
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 0 });
  });

  it("re-dispatches a pending event whose dispatch job never ran", async () => {
    const id = await makeStuck({ status: "pending" }, AUTOMATION.stuckGraceMs + 1000);
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    expect(await sweep()).toEqual({ redispatched: 1, timedOut: 0 });
    expect((await status(id)).updatedAt).toBeGreaterThanOrEqual(FIXED_NOW);
    await dispatchOnce();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not re-arm the same event twice in one grace window", async () => {
    await makeStuck({ status: "pending" }, AUTOMATION.stuckGraceMs + 1000);
    await sweep();
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 0 });
  });

  it("gives a failed event its backoff plus grace before re-arming it", async () => {
    const early = await makeStuck({ status: "failed", attempts: 2 }, AUTOMATION.stuckGraceMs + 1000);
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 0 });
    await t.run((ctx) => ctx.db.patch(early, { updatedAt: FIXED_NOW - AUTOMATION.stuckGraceMs - 3 * 60 * 1000 }));
    expect(await sweep()).toEqual({ redispatched: 1, timedOut: 0 });
  });

  it("never re-arms events that exhausted their attempts", async () => {
    await makeStuck({ status: "failed", attempts: AUTOMATION.maxAttempts }, 10 * 60 * 60 * 1000);
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 0 });
  });

  it("times out an event stuck in processing past the ack timeout plus grace", async () => {
    const id = await makeStuck({ status: "processing", attempts: 1, lastAttemptAt: FIXED_NOW - AUTOMATION.ackTimeoutMs - AUTOMATION.stuckGraceMs - 1000 }, 0);
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 1 });
    expect(await status(id)).toMatchObject({ status: "failed", errorCode: "ACK_TIMEOUT" });
  });

  it("leaves a processing event alone while n8n still has time to answer", async () => {
    const id = await makeStuck({ status: "processing", attempts: 1, lastAttemptAt: FIXED_NOW - 60_000 }, 0);
    expect(await sweep()).toEqual({ redispatched: 0, timedOut: 0 });
    expect((await status(id)).status).toBe("processing");
  });
});

describe("n8n -> Convex request signing (optional second factor)", () => {
  const SIGNING_SECRET = "k".repeat(48);
  const ROUTE = "/n8n/overdue/run";
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const signedHeaders = async (options: { route?: string; body?: string; offsetSeconds?: number; secret?: string } = {}) => {
    const timestamp = String(nowSeconds() + (options.offsetSeconds ?? 0));
    const signature = await signWebhook({ secret: options.secret ?? SIGNING_SECRET, timestamp, deliveryId: options.route ?? ROUTE, rawBody: options.body ?? "{}" });
    return { ...authHeaders, "x-lendloop-timestamp": timestamp, "x-lendloop-signature": signature };
  };

  beforeEach(() => {
    process.env.N8N_CONVEX_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("accepts a correctly signed request", async () => {
    expect((await post(ROUTE, "{}", await signedHeaders())).status).toBe(200);
  });

  it("rejects a bearer-only request once a signing secret is configured", async () => {
    const response = await post(ROUTE, "{}");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  it("still requires the bearer token, even with a valid signature", async () => {
    const headers = { ...(await signedHeaders()), authorization: "Bearer wrong-token-wrong-token-wrong-token-1234" };
    expect((await post(ROUTE, "{}", headers)).status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    expect((await post(ROUTE, '{"x":1}', await signedHeaders({ body: "{}" }))).status).toBe(401);
  });

  it("rejects a signature made for a different route (no cross-endpoint replay)", async () => {
    expect((await post(ROUTE, "{}", await signedHeaders({ route: "/n8n/errors" }))).status).toBe(401);
  });

  it("rejects stale and future-dated timestamps", async () => {
    const stale = await post(ROUTE, "{}", await signedHeaders({ offsetSeconds: -(AUTOMATION.signatureToleranceSeconds + 5) }));
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: "stale_request" });
    expect((await post(ROUTE, "{}", await signedHeaders({ offsetSeconds: AUTOMATION.signatureToleranceSeconds + 5 }))).status).toBe(401);
  });

  it("rejects a signature made with the wrong key, including the bearer secret", async () => {
    expect((await post(ROUTE, "{}", await signedHeaders({ secret: "z".repeat(48) }))).status).toBe(401);
    expect((await post(ROUTE, "{}", await signedHeaders({ secret: API_SECRET }))).status).toBe(401);
  });

  it("fails closed when the signing secret is configured but too short", async () => {
    process.env.N8N_CONVEX_SIGNING_SECRET = "short";
    expect((await post(ROUTE, "{}")).status).toBe(503);
  });

  it("keeps working bearer-only when no signing secret is configured", async () => {
    delete process.env.N8N_CONVEX_SIGNING_SECRET;
    expect((await post(ROUTE, "{}")).status).toBe(200);
  });
});
