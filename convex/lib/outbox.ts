import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type RequestEventType =
  | "request.created"
  | "request.approved"
  | "request.declined"
  | "request.cancelled";

/** Who must hear about each event; n8n re-checks this mapping before sending. */
export const RECIPIENT_ROLE_BY_EVENT: Record<RequestEventType, "lender" | "borrower"> = {
  "request.created": "lender",
  "request.approved": "borrower",
  "request.declined": "borrower",
  "request.cancelled": "lender",
};

export function requestEventKey(eventType: RequestEventType, requestId: string): string {
  return `${eventType}:${requestId}`;
}

/**
 * Transactional outbox: the event row and the scheduled dispatch commit in the
 * same transaction as the business change. If the mutation rolls back, neither
 * exists; if it commits, delivery is guaranteed to be attempted even when n8n
 * is down right now (the dispatcher retries with backoff and failures stay
 * visible as `failed` rows).
 */
export async function enqueueRequestEvent(
  ctx: MutationCtx,
  request: Doc<"borrowRequests">,
  eventType: RequestEventType,
): Promise<void> {
  const eventKey = requestEventKey(eventType, request._id);
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
    .unique();
  if (existing) return;

  const now = Date.now();
  const eventId = await ctx.db.insert("automationEvents", {
    eventKey,
    eventType,
    correlationId: crypto.randomUUID(),
    requestId: request._id,
    recipientUserId: RECIPIENT_ROLE_BY_EVENT[eventType] === "lender" ? request.lenderId : request.borrowerId,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.automation.dispatch, { eventId });
}
