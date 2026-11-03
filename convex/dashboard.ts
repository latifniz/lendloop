import { v } from "convex/values";
import { isPastDue } from "../lib/utils/dates";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireAuthenticatedUser } from "./lib/auth";

/** Counts are capped so a dashboard load never scans an unbounded range. */
const COUNT_CAP = 100;

async function countOpenLoans(ctx: QueryCtx, userId: Doc<"users">["_id"], now: number) {
  const [activeLent, activeBorrowed, overdueLent, overdueBorrowed] = await Promise.all([
    ctx.db.query("loans").withIndex("by_lenderId_and_status", (q) => q.eq("lenderId", userId).eq("status", "active")).take(COUNT_CAP),
    ctx.db.query("loans").withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", userId).eq("status", "active")).take(COUNT_CAP),
    ctx.db.query("loans").withIndex("by_lenderId_and_status", (q) => q.eq("lenderId", userId).eq("status", "overdue")).take(COUNT_CAP),
    ctx.db.query("loans").withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", userId).eq("status", "overdue")).take(COUNT_CAP),
  ]);
  const active = [...activeLent, ...activeBorrowed];
  const pastDueActive = active.filter((loan) => isPastDue(loan.endDate, now)).length;
  return {
    active: active.length - pastDueActive,
    overdue: overdueLent.length + overdueBorrowed.length + pastDueActive,
  };
}

/** Everything here is scoped to the caller: only their own listings, requests and loans are counted. */
export const summary = query({
  args: {},
  returns: v.object({
    activeListings: v.number(),
    myPendingRequests: v.number(),
    incomingPendingRequests: v.number(),
    activeLoans: v.number(),
    overdueLoans: v.number(),
    cap: v.number(),
  }),
  handler: async (ctx) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const now = Date.now();
    const [listings, myPending, incomingPending, loans] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
        .filter((q) => q.eq(q.field("status"), "available"))
        .take(COUNT_CAP),
      ctx.db.query("borrowRequests").withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", viewer._id).eq("status", "pending")).take(COUNT_CAP),
      ctx.db.query("borrowRequests").withIndex("by_lenderId_and_status", (q) => q.eq("lenderId", viewer._id).eq("status", "pending")).take(COUNT_CAP),
      countOpenLoans(ctx, viewer._id, now),
    ]);
    return {
      activeListings: listings.length,
      myPendingRequests: myPending.length,
      incomingPendingRequests: incomingPending.length,
      activeLoans: loans.active,
      overdueLoans: loans.overdue,
      cap: COUNT_CAP,
    };
  },
});

/** Recent automated messages addressed to the caller (e.g. overdue reminders they received). */
export const recentActivity = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const events = await ctx.db
      .query("automationEvents")
      .withIndex("by_recipientUserId", (q) => q.eq("recipientUserId", viewer._id))
      .order("desc")
      .take(8);
    return events.map((event) => ({
      _id: event._id,
      eventType: event.eventType,
      status: event.status,
      createdAt: event.createdAt,
    }));
  },
});
