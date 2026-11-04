import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { daysOverdue, isPastDue } from "../lib/utils/dates";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { publicDisplayName, requireAdmin, requireAuthenticatedUser } from "./lib/auth";
import { errors } from "./lib/errors";
import { requireLender, requireLoanParticipant } from "./lib/permissions";
import { assertLoanTransition } from "./lib/stateMachine";
import { loanStatusValidator } from "./schema";

/**
 * The stored status flips to "overdue" when the daily n8n run executes. Until
 * then a still-"active" loan past its due day is presented as overdue, so the UI
 * is never stale between runs.
 */
export function effectiveLoanStatus(loan: Doc<"loans">, now: number): Doc<"loans">["status"] {
  if (loan.status === "active" && isPastDue(loan.endDate, now)) return "overdue";
  return loan.status;
}

/** The most recent overdue-reminder notification for a loan, so the app can show "Reminder sent 2 days ago". */
async function latestReminder(ctx: QueryCtx, loanId: Doc<"loans">["_id"]) {
  const events = await ctx.db.query("automationEvents").withIndex("by_loanId", (q) => q.eq("loanId", loanId)).order("desc").take(5);
  const event = events.find((candidate) => candidate.eventType === "loan.overdue_reminder" && candidate.status !== "skipped");
  if (!event) return null;
  return { status: event.status, at: event.sentAt ?? event.createdAt };
}

async function toView(ctx: QueryCtx, loans: Doc<"loans">[]) {
  const now = Date.now();
  const toolIds = [...new Set(loans.map((loan) => loan.toolId))];
  const userIds = [...new Set(loans.flatMap((loan) => [loan.borrowerId, loan.lenderId]))];
  const [tools, users] = await Promise.all([
    Promise.all(toolIds.map((id) => ctx.db.get(id))),
    Promise.all(userIds.map((id) => ctx.db.get(id))),
  ]);
  const toolById = new Map(toolIds.map((id, index) => [id, tools[index] ?? null]));
  const userById = new Map(userIds.map((id, index) => [id, users[index] ?? null]));
  const reminders = await Promise.all(loans.map((loan) => latestReminder(ctx, loan._id)));

  return loans.map((loan, index) => {
    const status = effectiveLoanStatus(loan, now);
    return {
      _id: loan._id,
      toolName: toolById.get(loan.toolId)?.name ?? "Removed tool",
      borrowerName: publicDisplayName(userById.get(loan.borrowerId) ?? null),
      lenderName: publicDisplayName(userById.get(loan.lenderId) ?? null),
      startDate: loan.startDate,
      endDate: loan.endDate,
      status,
      daysOverdue: status === "overdue" ? daysOverdue(loan.endDate, now) : 0,
      returnedAt: loan.returnedAt,
      lastReminder: reminders[index] ?? null,
    };
  });
}

export const listMine = query({
  args: { role: v.union(v.literal("borrower"), v.literal("lender")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { role, paginationOpts }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const page =
      role === "borrower"
        ? await ctx.db
            .query("loans")
            .withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", viewer._id))
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("loans")
            .withIndex("by_lenderId_and_status", (q) => q.eq("lenderId", viewer._id))
            .order("desc")
            .paginate(paginationOpts);
    return { ...page, page: (await toView(ctx, page.page)).map((loan) => ({ ...loan, viewerRole: role })) };
  },
});

export const get = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const { loan, role } = await requireLoanParticipant(ctx, viewer, loanId);
    const [view] = await toView(ctx, [loan]);
    return { ...view, viewerRole: role };
  },
});

/**
 * Only the lender holds the tool's custody record, so only the lender confirms
 * the return. The request stays "approved" (a terminal state) and keeps its
 * history; the loan carries the return outcome.
 */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const { loan, role } = await requireLoanParticipant(ctx, actor, loanId);
    if (role !== "lender") throw errors.forbidden("Only the lender can mark a loan as returned.");
    assertLoanTransition(loan.status, "returned");

    // Consistency check across the three records before closing the loan.
    const request = await requireLender(ctx, actor, loan.requestId);
    if (request.status !== "approved" || request.toolId !== loan.toolId) {
      throw errors.invalidState("This loan does not match its request and cannot be closed.");
    }

    const now = Date.now();
    await ctx.db.patch(loanId, { status: "returned", returnedAt: now, updatedAt: now });
    await ctx.db.patch(loan.toolId, { updatedAt: now });
    return null;
  },
});

export const listForAdmin = query({
  args: { status: v.optional(loanStatusValidator), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    await requireAdmin(ctx);
    const page = status
      ? await ctx.db
          .query("loans")
          .withIndex("by_status_and_endDate", (q) => q.eq("status", status))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db.query("loans").order("desc").paginate(paginationOpts);
    return { ...page, page: await toView(ctx, page.page) };
  },
});
