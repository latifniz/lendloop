import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Fixed-window counter. Cheap and good enough to cap a leaked or runaway
 * integration credential; per-IP limiting belongs at the edge (see README).
 */
export const consume = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  returns: v.object({ allowed: v.boolean(), retryAfterSeconds: v.number() }),
  handler: async (ctx, { key, limit, windowMs }) => {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (!row) {
      await ctx.db.insert("rateLimits", { key, windowStart, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (row.windowStart < windowStart) {
      await ctx.db.patch(row._id, { windowStart, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (row.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000) };
    }
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  },
});
