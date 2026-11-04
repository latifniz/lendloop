import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));
export const toolStatusValidator = v.union(
  v.literal("available"),
  v.literal("unavailable"),
  v.literal("removed"),
);
export const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
);
export const auditActionValidator = v.union(
  v.literal("tool.removed_by_admin"),
  v.literal("user.trusted_lender_changed"),
  v.literal("user.role_changed"),
  v.literal("automation.retry_requested"),
);
export const auditTargetValidator = v.union(v.literal("tool"), v.literal("user"), v.literal("automationEvent"));
export const loanStatusValidator = v.union(
  v.literal("active"),
  v.literal("returned"),
  v.literal("overdue"),
);
export const automationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("skipped"),
);
export const automationEventTypeValidator = v.union(
  v.literal("request.created"),
  v.literal("request.approved"),
  v.literal("request.declined"),
  v.literal("request.cancelled"),
  v.literal("loan.overdue_reminder"),
  v.literal("workflow.error"),
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: roleValidator,
    isTrustedLender: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Identity resolution on every authenticated call; also enforces "one row per Clerk user".
    .index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    status: toolStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // "My listings" and owner-scoped lookups.
    .index("by_ownerId", ["ownerId"])
    // Public landing list and unfiltered browsing: newest first (the index ends in _creationTime).
    // A (status, category) index cannot serve this: it sorts by category before time.
    .index("by_status", ["status"])
    // Category-filtered browsing (status + category), newest first within the category.
    .index("by_status_and_category", ["status", "category"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.number(),
    endDate: v.number(),
    message: v.optional(v.string()),
    status: requestStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // "My requests" (borrower view) and per-borrower pending cap.
    .index("by_borrowerId_and_status", ["borrowerId", "status"])
    // "Incoming requests" (lender view), optionally narrowed by status.
    .index("by_lenderId_and_status", ["lenderId", "status"])
    // Duplicate-request detection and cascading cancel when a tool is removed.
    .index("by_toolId_and_status", ["toolId", "status"]),

  loans: defineTable({
    requestId: v.id("borrowRequests"),
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.number(),
    endDate: v.number(),
    status: loanStatusValidator,
    returnedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // One loan per request: guarantees an approved request can never yield duplicate loans.
    .index("by_requestId", ["requestId"])
    // Overlap check on approval: open loans of one tool. Its read range is what makes
    // concurrent approvals conflict under Convex's optimistic concurrency control.
    .index("by_toolId_and_status", ["toolId", "status"])
    .index("by_borrowerId_and_status", ["borrowerId", "status"])
    .index("by_lenderId_and_status", ["lenderId", "status"])
    // Overdue sweep: open loans ordered by due date; admin listings by status.
    .index("by_status_and_endDate", ["status", "endDate"]),

  automationEvents: defineTable({
    eventKey: v.string(),
    eventType: automationEventTypeValidator,
    correlationId: v.string(),
    loanId: v.optional(v.id("loans")),
    requestId: v.optional(v.id("borrowRequests")),
    recipientUserId: v.optional(v.id("users")),
    status: automationStatusValidator,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    // Lease taken by n8n's /claim call; a second claim inside the lease is refused (duplicate delivery).
    claimedAt: v.optional(v.number()),
    // Signed delivery that currently owns the claim; each deliveryId can be claimed once (replay protection).
    claimedDeliveryId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    workflowName: v.optional(v.string()),
    executionId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Idempotency: one event per deterministic key.
    .index("by_eventKey", ["eventKey"])
    // Admin monitoring (failed / stuck events), newest first.
    .index("by_status", ["status"])
    // "Recent activity" for a recipient.
    .index("by_recipientUserId", ["recipientUserId"])
    // "Reminder sent 2 days ago" on each loan.
    .index("by_loanId", ["loanId"]),

  // Append-only record of privileged actions. No e-mail addresses or message text: ids, an action name and a short detail.
  auditLogs: defineTable({
    // Absent when the action came from the Convex dashboard/CLI (internal functions), not from a signed-in admin.
    actorId: v.optional(v.id("users")),
    action: auditActionValidator,
    targetType: auditTargetValidator,
    targetId: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  // Fixed-window counters protecting the n8n-facing HTTP endpoints.
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
});
