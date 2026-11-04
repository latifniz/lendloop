import { recordAudit } from "./lib/audit";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { TOOL_CATEGORIES } from "../lib/constants";
import { toolInputSchema } from "../lib/validation/schemas";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { publicDisplayName, requireAdmin, requireAuthenticatedUser } from "./lib/auth";
import { errors } from "./lib/errors";
import { requireToolOwner } from "./lib/permissions";
import { assertRequestTransition, isOpenLoan } from "./lib/stateMachine";
import { parseOrThrow } from "./lib/validation";

const PUBLIC_LANDING_LIMIT = 24;

const toolFieldsValidator = {
  name: v.string(),
  category: v.string(),
  condition: v.string(),
  description: v.string(),
};

/**
 * PUBLIC, unauthenticated. The `returns` validator is an allow-list: even if the
 * handler were changed to return a full document, Convex would reject the
 * response, so owner ids, descriptions and contact details cannot leak here.
 */
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), category: v.string() })),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_and_category", (q) => q.eq("status", "available"))
      .order("desc")
      .take(PUBLIC_LANDING_LIMIT);
    return tools.map((tool) => ({ name: tool.name, category: tool.category }));
  },
});

async function currentLoanEndDate(ctx: QueryCtx, toolId: Id<"tools">): Promise<number | null> {
  const [active, overdue] = await Promise.all([
    ctx.db
      .query("loans")
      .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "active"))
      .take(10),
    ctx.db
      .query("loans")
      .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "overdue"))
      .take(10),
  ]);
  const ends = [...active, ...overdue].map((loan) => loan.endDate);
  return ends.length > 0 ? Math.max(...ends) : null;
}

async function loadOwners(ctx: QueryCtx, tools: Doc<"tools">[]): Promise<Map<Id<"users">, Doc<"users"> | null>> {
  const ownerIds = [...new Set(tools.map((tool) => tool.ownerId))];
  const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
  return new Map(ownerIds.map((id, index) => [id, owners[index] ?? null]));
}

export const listBrowse = query({
  args: { category: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { category, paginationOpts }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    if (category !== undefined && !(TOOL_CATEGORIES as readonly string[]).includes(category)) {
      throw errors.validation("Unknown category.");
    }

    const page = await ctx.db
      .query("tools")
      .withIndex("by_status_and_category", (q) =>
        category === undefined ? q.eq("status", "available") : q.eq("status", "available").eq("category", category),
      )
      .order("desc")
      .paginate(paginationOpts);

    const owners = await loadOwners(ctx, page.page);
    // One indexed read per tool on a bounded page (<= page size); avoids a join table.
    const busyUntil = await Promise.all(page.page.map((tool) => currentLoanEndDate(ctx, tool._id)));

    return {
      ...page,
      page: page.page.map((tool, index) => {
        const owner = owners.get(tool.ownerId) ?? null;
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          isMine: tool.ownerId === viewer._id,
          ownerName: publicDisplayName(owner),
          ownerIsTrusted: owner?.isTrustedLender ?? false,
          onLoanUntil: busyUntil[index] ?? null,
          createdAt: tool.createdAt,
        };
      }),
    };
  },
});

export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const page = await ctx.db
      .query("tools")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .filter((q) => q.neq(q.field("status"), "removed"))
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (tool) => ({
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          status: tool.status,
          onLoanUntil: await currentLoanEndDate(ctx, tool._id),
          createdAt: tool.createdAt,
        })),
      ),
    };
  },
});

/** Owner-only: used by the edit form. Non-owners get FORBIDDEN, unknown ids NOT_FOUND. */
export const getForEdit = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireAuthenticatedUser(ctx);
    const tool = await requireToolOwner(ctx, viewer, toolId);
    return {
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      status: tool.status,
    };
  },
});

export const create = mutation({
  args: toolFieldsValidator,
  returns: v.id("tools"),
  handler: async (ctx, args) => {
    const owner = await requireAuthenticatedUser(ctx);
    const input = parseOrThrow(toolInputSchema, args);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: owner._id, // derived from the session, never from arguments
      ...input,
      status: "available",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    ...toolFieldsValidator,
    status: v.optional(v.union(v.literal("available"), v.literal("unavailable"))),
  },
  returns: v.null(),
  handler: async (ctx, { toolId, status, ...fields }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const tool = await requireToolOwner(ctx, actor, toolId);
    const input = parseOrThrow(toolInputSchema, fields);
    await ctx.db.patch(tool._id, { ...input, ...(status ? { status } : {}), updatedAt: Date.now() });
    return null;
  },
});

/**
 * Soft delete. Owners may remove their own listing once nothing is out on loan;
 * admins may remove any listing (moderation). Pending requests are closed so
 * nobody keeps waiting on a listing that no longer exists.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const actor = await requireAuthenticatedUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status === "removed") throw errors.notFound("Tool");

    const isOwner = tool.ownerId === actor._id;
    if (!isOwner) await requireAdmin(ctx);

    if (isOwner) {
      const openLoans = await ctx.db
        .query("loans")
        .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId))
        .take(50);
      if (openLoans.some((loan) => isOpenLoan(loan.status))) {
        throw errors.conflict("This tool is currently on loan. Mark it as returned before removing it.");
      }
    }

    const now = Date.now();
    const pending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .take(200);
    for (const request of pending) {
      assertRequestTransition(request.status, "cancelled");
      await ctx.db.patch(request._id, { status: "cancelled", updatedAt: now });
    }

    await ctx.db.patch(toolId, { status: "removed", updatedAt: now });
    if (!isOwner) {
      await recordAudit(ctx, { actor, action: "tool.removed_by_admin", targetType: "tool", targetId: toolId, detail: `cancelledPending=${pending.length}` });
    }
    return null;
  },
});

export const listForAdmin = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const page = await ctx.db.query("tools").order("desc").paginate(paginationOpts);
    const owners = await loadOwners(ctx, page.page);
    return {
      ...page,
      page: page.page.map((tool) => ({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        status: tool.status,
        ownerName: publicDisplayName(owners.get(tool.ownerId) ?? null),
        createdAt: tool.createdAt,
      })),
    };
  },
});

