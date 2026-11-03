import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { AUTOMATION, MS_PER_DAY } from "../lib/constants";
import { daysOverdue, formatIsoDay } from "../lib/utils/dates";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { publicDisplayName, requireAdmin } from "./lib/auth";
import { readOutboundConfig } from "./lib/env";
import { errors } from "./lib/errors";
import { RECIPIENT_ROLE_BY_EVENT, type RequestEventType } from "./lib/outbox";
import { signWebhook } from "./lib/signing";
import { assertLoanTransition } from "./lib/stateMachine";
import { automationStatusValidator } from "./schema";

const PAYLOAD_SCHEMA_VERSION = 1;
const OVERDUE_BATCH_SIZE = 100;
const OVERDUE_SCAN_LIMIT = 500;

export function retryDelayMs(attempt: number): number {
  return Math.min(AUTOMATION.baseRetryDelayMs * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

async function scheduleRetry(ctx: MutationCtx, event: Doc<"automationEvents">, attempts: number): Promise<void> {
  if (attempts >= AUTOMATION.maxAttempts) return;
  await ctx.scheduler.runAfter(retryDelayMs(attempts), internal.automation.dispatch, { eventId: event._id });
}

/* -------------------------------------------------------------------------- */
/* Outbound: Convex -> n8n (request notifications)                             */
/* -------------------------------------------------------------------------- */

/** pending|failed -> processing. Returns null when the event is not eligible (duplicate job, exhausted, already sent). */
export const claimForDispatch = internalMutation({
  args: { eventId: v.id("automationEvents") },
  returns: v.union(v.null(), v.object({ attempt: v.number(), correlationId: v.string() })),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status === "sent" || event.status === "processing" || event.status === "skipped") return null;
    if (event.eventType === "loan.overdue_reminder" || event.eventType === "workflow.error") return null;
    if (event.attempts >= AUTOMATION.maxAttempts) return null;

    const attempt = event.attempts + 1;
    const now = Date.now();
    await ctx.db.patch(eventId, {
      status: "processing",
      attempts: attempt,
      lastAttemptAt: now,
      claimedAt: undefined,
      claimedDeliveryId: undefined,
      errorCode: undefined,
      updatedAt: now,
    });
    return { attempt, correlationId: event.correlationId };
  },
});

export const loadDispatchContext = internalQuery({
  args: { eventId: v.id("automationEvents") },
  returns: v.union(
    v.null(),
    v.object({
      eventKey: v.string(),
      eventType: v.string(),
      recipientRole: v.union(v.literal("lender"), v.literal("borrower")),
      recipientName: v.string(),
      recipientEmail: v.union(v.string(), v.null()),
      counterpartName: v.string(),
      toolName: v.string(),
      requestStatus: v.string(),
      startDate: v.number(),
      endDate: v.number(),
      message: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event?.requestId) return null;
    const request = await ctx.db.get(event.requestId);
    if (!request) return null;
    const eventType = event.eventType as RequestEventType;
    const recipientRole = RECIPIENT_ROLE_BY_EVENT[eventType];
    const [tool, lender, borrower] = await Promise.all([
      ctx.db.get(request.toolId),
      ctx.db.get(request.lenderId),
      ctx.db.get(request.borrowerId),
    ]);
    const recipient = recipientRole === "lender" ? lender : borrower;
    const counterpart = recipientRole === "lender" ? borrower : lender;
    return {
      eventKey: event.eventKey,
      eventType,
      recipientRole,
      recipientName: publicDisplayName(recipient),
      recipientEmail: recipient?.email ?? null,
      counterpartName: publicDisplayName(counterpart),
      toolName: tool?.name ?? "a tool",
      requestStatus: request.status,
      startDate: request.startDate,
      endDate: request.endDate,
      // The borrower's note is only relevant to the lender reading a new request.
      message: eventType === "request.created" ? (request.message ?? null) : null,
    };
  },
});

type DispatchOutcome =
  | { kind: "accepted" }
  | { kind: "retryable"; errorCode: string }
  | { kind: "permanent"; errorCode: string };

export const finishDispatch = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    attempt: v.number(),
    outcome: v.union(
      v.object({ kind: v.literal("accepted") }),
      v.object({ kind: v.literal("retryable"), errorCode: v.string() }),
      v.object({ kind: v.literal("permanent"), errorCode: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, attempt, outcome }) => {
    const event = await ctx.db.get(eventId);
    // Stale call (the event moved on, e.g. n8n already acknowledged it).
    if (!event || event.attempts !== attempt || event.status !== "processing") return null;
    const now = Date.now();

    if (outcome.kind === "accepted") {
      // Accepted is NOT delivered: stay "processing" until n8n reports the real outcome.
      await ctx.scheduler.runAfter(AUTOMATION.ackTimeoutMs, internal.automation.checkAckTimeout, { eventId, attempt });
      return null;
    }
    await ctx.db.patch(eventId, { status: "failed", errorCode: outcome.errorCode, updatedAt: now });
    if (outcome.kind === "retryable") await scheduleRetry(ctx, event, attempt);
    return null;
  },
});

export const checkAckTimeout = internalMutation({
  args: { eventId: v.id("automationEvents"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { eventId, attempt }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "processing" || event.attempts !== attempt) return null;
    await ctx.db.patch(eventId, { status: "failed", errorCode: "ACK_TIMEOUT", updatedAt: Date.now() });
    await scheduleRetry(ctx, event, attempt);
    return null;
  },
});

function classifyHttpStatus(status: number): DispatchOutcome {
  if (status >= 200 && status < 300) return { kind: "accepted" };
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return { kind: retryable ? "retryable" : "permanent", errorCode: `N8N_HTTP_${status}` };
}

export const dispatch = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }): Promise<void> => {
    const claim = await ctx.runMutation(internal.automation.claimForDispatch, { eventId });
    if (!claim) return;

    const finish = (outcome: DispatchOutcome) =>
      ctx.runMutation(internal.automation.finishDispatch, { eventId, attempt: claim.attempt, outcome });

    const config = readOutboundConfig();
    if (!config.ok) {
      // Names the invalid variables, never their values.
      console.error("n8n integration is misconfigured", { problems: config.problems });
      await finish({ kind: "permanent", errorCode: "CONFIG_INVALID" });
      return;
    }

    const context = await ctx.runQuery(internal.automation.loadDispatchContext, { eventId });
    if (!context || !context.recipientEmail) {
      await finish({ kind: "permanent", errorCode: context ? "NO_RECIPIENT_EMAIL" : "SOURCE_MISSING" });
      return;
    }

    const deliveryId = crypto.randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000));
    // Data minimisation: only what the notification needs (one recipient, no ids, no profiles).
    const body = JSON.stringify({
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      eventId: context.eventKey,
      deliveryId,
      eventType: context.eventType,
      correlationId: claim.correlationId,
      attempt: claim.attempt,
      recipient: { role: context.recipientRole, name: context.recipientName, email: context.recipientEmail },
      counterpartName: context.counterpartName,
      tool: { name: context.toolName },
      request: {
        status: context.requestStatus,
        startDate: formatIsoDay(context.startDate),
        endDate: formatIsoDay(context.endDate),
        message: context.message,
      },
      actionUrl: `${config.value.appUrl}${context.recipientRole === "lender" ? "/requests/incoming" : "/requests"}`,
    });
    const signature = await signWebhook({ secret: config.value.webhookSecret, timestamp, deliveryId, rawBody: body });

    try {
      const response = await fetch(config.value.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-delivery-id": deliveryId,
          "x-lendloop-correlation-id": claim.correlationId,
          "x-lendloop-signature": signature,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(AUTOMATION.dispatchTimeoutMs),
      });
      await finish(classifyHttpStatus(response.status));
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      console.error("n8n dispatch failed", { correlationId: claim.correlationId, timedOut });
      await finish({ kind: "retryable", errorCode: timedOut ? "TIMEOUT" : "NETWORK_ERROR" });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Inbound: n8n -> Convex (called only from convex/http.ts after authentication) */
/* -------------------------------------------------------------------------- */

const claimResultValidator = v.object({
  proceed: v.boolean(),
  reason: v.optional(v.string()),
});

/**
 * Asks "may I still send this notification?". This is the authoritative guard
 * against duplicate sends: it refuses events that are already handled, and it
 * hands out a time-boxed lease so two concurrent deliveries of the same event
 * (webhook replay, n8n retry, overlapping sweeps) cannot both proceed.
 */
export const claimForNotification = internalMutation({
  args: { eventKey: v.string(), deliveryId: v.optional(v.string()) },
  returns: v.union(v.null(), claimResultValidator),
  handler: async (ctx, { eventKey, deliveryId }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (!event) return null;
    if (event.status === "sent" || event.status === "skipped") return { proceed: false, reason: "already_handled" };
    if (deliveryId !== undefined && event.claimedDeliveryId === deliveryId) {
      return { proceed: false, reason: "replayed_delivery" };
    }

    const now = Date.now();
    const isReminder = event.eventType === "loan.overdue_reminder";
    if (isReminder && event.loanId) {
      const loan = await ctx.db.get(event.loanId);
      if (!loan || loan.status === "returned") {
        await ctx.db.patch(event._id, { status: "skipped", errorCode: "LOAN_RETURNED", updatedAt: now });
        return { proceed: false, reason: "loan_returned" };
      }
    }

    // Request events are only sendable while the dispatcher has them in flight.
    if (!isReminder && event.status !== "processing") return { proceed: false, reason: "not_dispatched" };
    const leaseActive =
      event.status === "processing" && event.claimedAt !== undefined && now - event.claimedAt < AUTOMATION.claimLeaseMs;
    if (leaseActive) return { proceed: false, reason: "claim_in_progress" };

    await ctx.db.patch(event._id, {
      status: "processing",
      claimedAt: now,
      claimedDeliveryId: deliveryId,
      updatedAt: now,
      // Reminders are pulled by n8n, so each claim is an attempt; request attempts are counted by the dispatcher.
      ...(isReminder ? { attempts: event.attempts + 1, lastAttemptAt: now } : {}),
    });
    return { proceed: true };
  },
});

export const recordResult = internalMutation({
  args: {
    eventKey: v.string(),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    errorCode: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({ status: automationStatusValidator, duplicate: v.boolean() }),
  ),
  handler: async (ctx, { eventKey, outcome, errorCode, retryable }) => {
    const event = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (!event) return null;

    // Idempotency: a repeated write-back changes nothing. "sent" is final and is never downgraded.
    if (event.status === "sent" || event.status === "skipped") return { status: event.status, duplicate: true };
    if (outcome === "failed" && event.status === "failed" && event.errorCode === (errorCode ?? "UNKNOWN")) {
      return { status: "failed" as const, duplicate: true };
    }

    const now = Date.now();
    if (outcome === "sent") {
      await ctx.db.patch(event._id, { status: "sent", sentAt: now, errorCode: undefined, updatedAt: now });
      return { status: "sent" as const, duplicate: false };
    }

    await ctx.db.patch(event._id, { status: "failed", errorCode: errorCode ?? "UNKNOWN", updatedAt: now });
    if (retryable && event.requestId) await scheduleRetry(ctx, event, event.attempts);
    return { status: "failed" as const, duplicate: false };
  },
});

export const startOverdueRun = internalMutation({
  args: {},
  returns: v.object({
    runDate: v.string(),
    truncated: v.boolean(),
    reminders: v.array(
      v.object({
        eventKey: v.string(),
        correlationId: v.string(),
        borrower: v.object({ name: v.string(), email: v.string() }),
        lenderName: v.string(),
        toolName: v.string(),
        dueDate: v.string(),
        daysOverdue: v.number(),
        actionUrl: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const runDate = formatIsoDay(now);
    const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";

    // 1. Persist active -> overdue for loans whose due day has fully passed.
    const newlyOverdue = await ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) => q.eq("status", "active").lt("endDate", now - MS_PER_DAY + 1))
      .take(OVERDUE_BATCH_SIZE);
    for (const loan of newlyOverdue) {
      assertLoanTransition(loan.status, "overdue");
      await ctx.db.patch(loan._id, { status: "overdue", updatedAt: now });
    }

    // 2. Reminders for every overdue (never returned) loan, once per loan per UTC day.
    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) => q.eq("status", "overdue"))
      .take(OVERDUE_SCAN_LIMIT);

    const reminders = [];
    let truncated = overdue.length === OVERDUE_SCAN_LIMIT;
    for (const loan of overdue) {
      if (reminders.length >= OVERDUE_BATCH_SIZE) {
        truncated = true;
        break;
      }
      const eventKey = `overdue-reminder:${loan._id}:${runDate}`;
      let event = await ctx.db
        .query("automationEvents")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
        .unique();
      if (event && (event.status === "sent" || event.status === "skipped")) continue;
      if (event && event.attempts >= AUTOMATION.maxAttempts) continue;

      const [borrower, lender, tool] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.lenderId),
        ctx.db.get(loan.toolId),
      ]);
      if (!event) {
        const eventId = await ctx.db.insert("automationEvents", {
          eventKey,
          eventType: "loan.overdue_reminder",
          correlationId: crypto.randomUUID(),
          loanId: loan._id,
          recipientUserId: loan.borrowerId,
          status: borrower?.email ? "pending" : "failed",
          attempts: 0,
          errorCode: borrower?.email ? undefined : "NO_RECIPIENT_EMAIL",
          createdAt: now,
          updatedAt: now,
        });
        event = await ctx.db.get(eventId);
      }
      if (!event || !borrower?.email) continue;

      reminders.push({
        eventKey,
        correlationId: event.correlationId,
        borrower: { name: publicDisplayName(borrower), email: borrower.email },
        lenderName: publicDisplayName(lender),
        toolName: tool?.name ?? "a tool",
        dueDate: formatIsoDay(loan.endDate),
        daysOverdue: daysOverdue(loan.endDate, now),
        actionUrl: `${appUrl}/loans`,
      });
    }
    return { runDate, truncated, reminders };
  },
});

export const recordWorkflowError = internalMutation({
  args: {
    workflowName: v.string(),
    executionId: v.string(),
    errorCategory: v.string(),
    correlationId: v.optional(v.string()),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, { workflowName, executionId, errorCategory, correlationId }) => {
    const eventKey = `workflow-error:${workflowName}:${executionId}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (existing) return { duplicate: true };

    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      eventKey,
      eventType: "workflow.error",
      correlationId: correlationId ?? crypto.randomUUID(),
      status: "failed",
      attempts: 1,
      lastAttemptAt: now,
      errorCode: errorCategory,
      workflowName,
      executionId,
      createdAt: now,
      updatedAt: now,
    });
    return { duplicate: false };
  },
});

/* -------------------------------------------------------------------------- */
/* Admin visibility and recovery                                               */
/* -------------------------------------------------------------------------- */

export const listRecent = query({
  args: { status: v.optional(automationStatusValidator), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    await requireAdmin(ctx);
    const page = status
      ? await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", status)).order("desc").paginate(paginationOpts)
      : await ctx.db.query("automationEvents").order("desc").paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((event) => ({
        _id: event._id,
        eventKey: event.eventKey,
        eventType: event.eventType,
        status: event.status,
        attempts: event.attempts,
        lastAttemptAt: event.lastAttemptAt,
        sentAt: event.sentAt,
        errorCode: event.errorCode,
        workflowName: event.workflowName,
        executionId: event.executionId,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
        canRetry: event.status === "failed" && event.requestId !== undefined,
      })),
    };
  },
});

/** Operator recovery for notifications that exhausted their automatic retries. */
export const retryFailed = mutation({
  args: { eventId: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    await requireAdmin(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw errors.notFound("Automation event");
    if (event.status !== "failed" || !event.requestId) {
      throw errors.invalidState("Only failed notification events can be retried.");
    }
    await ctx.db.patch(eventId, { status: "pending", attempts: 0, errorCode: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.dispatch, { eventId });
    return null;
  },
});

