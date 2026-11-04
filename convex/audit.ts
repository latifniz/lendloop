import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";

/** Newest first. Admin only: the log names who did what to which record. */
export const listRecent = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const page = await ctx.db.query("auditLogs").withIndex("by_createdAt").order("desc").paginate(paginationOpts);
    const actorNames = new Map<string, string>();
    const rows = [];
    for (const entry of page.page) {
      let actorName = "Convex dashboard";
      if (entry.actorId) {
        if (!actorNames.has(entry.actorId)) {
          const actor = await ctx.db.get(entry.actorId);
          actorNames.set(entry.actorId, actor?.name ?? "Unnamed member");
        }
        actorName = actorNames.get(entry.actorId) ?? "Unnamed member";
      }
      rows.push({
        _id: entry._id,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        detail: entry.detail ?? null,
        actorName,
        createdAt: entry.createdAt,
      });
    }
    return { ...page, page: rows };
  },
});
