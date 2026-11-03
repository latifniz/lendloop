import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { REQUEST_LIMITS } from "../lib/constants";
import { DATE_RANGE_MESSAGES, intervalsOverlap, validateDateRange } from "../lib/utils/dates";
import { requestInputSchema } from "../lib/validation/schemas";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { publicDisplayName, requireAuthenticatedUser } from "./lib/auth";
import { errors } from "./lib/errors";
import { enqueueRequestEvent } from "./lib/outbox";
import { requireBorrower, requireBorrowerOrLender, requireLender } from "./lib/permissions";
import { assertRequestTransition } from "./lib/stateMachine";
import { parseOrThrow } from "./lib/validation";
import { requestStatusValidator } from "./schema";

/** Open loans (active or overdue) of one tool that collide with the given range. */
async function findOverlappingLoan(
  ctx: QueryCtx | MutationCtx,
  toolId: Id<"tools">,
  range: { startDate: number; endDate: number },
): Promise<Doc<"loans"> | null> {
  for (const status of ["active", "overdue"] as const) {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", status))
      .collect();
    const clash = loans.find((loan) => intervalsOverlap(loan, range));
    if (clash) return clash;
  }
  return null;
}

export const create = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.number(),
    endDate: v.number(),
    message: v.optional(v.string()),
  },
  returns: v.id("borrowRequests"),
  handler: async (ctx, { toolId, ...rest }) => {
    const borrower = await requireAuthenticatedUser(ctx);
    const input = parseOrThrow(requestInputSchema, rest);
    const now = Date.now();

    const rangeProblem = validateDateRange(input, now);
    if (rangeProblem) throw errors.validation(DATE_RANGE_MESSAGES[rangeProblem]);

    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status === "removed") throw errors.notFound("Tool");
    if (tool.ownerId === borrower._id) throw errors.forbidden("You cannot borrow your own tool.");
    if (tool.status !== "available") throw errors.conflict("This tool is not available right now.");

    if (await findOverlappingLoan(ctx, toolId, input)) {
      throw errors.conflict("This tool is already booked for part of that period.");
    }

    const myPending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", borrower._id).eq("status", "pending"))
      .take(REQUEST_LIMITS.maxPendingPerBorrower);
    if (myPending.length >= REQUEST_LIMITS.maxPendingPerBorrower) {
      throw errors.conflict("You have too many pending requests. Wait for replies or cancel some first.");
    }
    if (myPending.some((request) => request.toolId === toolId && intervalsOverlap(request, input))) {
      throw errors.conflict("You already have a pending request for this tool in that period.");
    }

    const requestId = await ctx.db.insert("borrowRequests", {
      toolId,
      borrowerId: borrower._id,
      lenderId: tool.ownerId,
      startDate: input.startDate,
      endDate: input.endDate,
      message: input.message || undefined,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const request = await ctx.db.get(requestId);
    if (request) await enqueueRequestEvent(ctx, request, "request.created");
    return requestId;
  },
});

/**
 * Approval is the concurrency-critical path. Convex mutations are serializable
 * transactions with optimistic concurrency control: the overlap read below
 * covers the tool's whole open-loan index range, so if a concurrent approval
 * inserts an overlapping loan first, this transaction is retried, re-reads, and
 * fails the overlap check instead of creating a double booking.
 */
export const approve = mutation({
  args: { requestId: v.id("borrowRequests") },
  returns: v.id("loans"),
  handler: async (ctx, { requestId }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const request = await requireLender(ctx, actor, requestId);
    if (request.borrowerId === actor._id) throw errors.forbidden("You cannot approve your own request.");
    assertRequestTransition(request.status, "approved");

    const tool = await ctx.db.get(request.toolId);
    if (!tool || tool.status !== "available") {
      throw errors.conflict("This tool is no longer available.");
    }
    if (await findOverlappingLoan(ctx, request.toolId, request)) {
      throw errors.conflict("The tool is already lent out for part of that period.");
    }
    // Belt and braces: one loan per request even if the status check above were bypassed.
    const existingLoan = await ctx.db
      .query("loans")
      .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
      .first();
    if (existingLoan) throw errors.conflict("A loan already exists for this request.");

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      requestId,
      toolId: request.toolId,
      borrowerId: request.borrowerId,
      lenderId: request.lenderId,
      startDate: request.startDate,
      endDate: request.endDate,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(requestId, { status: "approved", updatedAt: now });
    await enqueueRequestEvent(ctx, { ...request, status: "approved" }, "request.approved");
    return loanId;
  },
});

export const decline = mutation({
  args: { requestId: v.id("borrowRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const request = await requireLender(ctx, actor, requestId);
    assertRequestTransition(request.status, "declined");
    await ctx.db.patch(requestId, { status: "declined", updatedAt: Date.now() });
    await enqueueRequestEvent(ctx, { ...request, status: "declined" }, "request.declined");
    return null;
  },
});

export const cancel = mutation({
  args: { requestId: v.id("borrowRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const request = await requireBorrower(ctx, actor, requestId);
    assertRequestTransition(request.status, "cancelled");
    await ctx.db.patch(requestId, { status: "cancelled", updatedAt: Date.now() });
    await enqueueRequestEvent(ctx, { ...request, status: "cancelled" }, "request.cancelled");
    return null;
  },
});

async function toView(ctx: QueryCtx, requests: Doc<"borrowRequests">[], counterpart: "lender" | "borrower") {
  const toolIds = [...new Set(requests.map((request) => request.toolId))];
  const userIds = [...new Set(requests.map((request) => request[`${counterpart}Id`]))];
  const [tools, users] = await Promise.all([
    Promise.all(toolIds.map((id) => ctx.db.get(id))),
    Promise.all(userIds.map((id) => ctx.db.get(id))),
  ]);
  const toolById = new Map(toolIds.map((id, index) => [id, tools[index] ?? null]));
  const userById = new Map(userIds.map((id, index) => [id, users[index] ?? null]));

  return requests.map((request) => {
    const other = userById.get(request[`${counterpart}Id`]) ?? null;
    return {
      _id: request._id,
      toolName: toolById.get(request.toolId)?.name ?? "Removed tool",
      toolRemoved: toolById.get(request.toolId)?.status === "removed",
      counterpartName: publicDisplayName(other),
      counterpartIsTrusted: other?.isTrustedLender ?? false,
      startDate: request.startDate,
      endDate: request.endDate,
      message: request.message,
      status: request.status,
      createdAt: request.createdAt,
    };
  });
}

export const listMine = query({
  args: { status: v.optional(requestStatusValidator), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const page = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrowerId_and_status", (q) =>
        status ? q.eq("borrowerId", viewer._id).eq("status", status) : q.eq("borrowerId", viewer._id),
      )
      .order("desc")
      .paginate(paginationOpts);
    return { ...page, page: await toView(ctx, page.page, "lender") };
  },
});

export const listIncoming = query({
  args: { status: v.optional(requestStatusValidator), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const page = await ctx.db
      .query("borrowRequests")
      .withIndex("by_lenderId_and_status", (q) =>
        status ? q.eq("lenderId", viewer._id).eq("status", status) : q.eq("lenderId", viewer._id),
      )
      .order("desc")
      .paginate(paginationOpts);
    return { ...page, page: await toView(ctx, page.page, "borrower") };
  },
});

/** Participants only; everyone else sees NOT_FOUND so ids cannot be probed. */
export const get = query({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, { requestId }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const { request, role } = await requireBorrowerOrLender(ctx, viewer, requestId);
    const [view] = await toView(ctx, [request], role === "borrower" ? "lender" : "borrower");
    return { ...view, viewerRole: role };
  },
});
