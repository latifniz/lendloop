import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin, getAuthenticatedUser } from "./lib/auth";
import { errors } from "./lib/errors";
import { roleValidator } from "./schema";

const NAME_MAX = 100;
const EMAIL_MAX = 254;

const clip = (value: string | undefined, max: number): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

/**
 * Creates or refreshes the application user for the signed-in Clerk identity.
 * Takes no arguments on purpose: identity, name and email come from the verified
 * JWT, and the role can never be influenced by the caller (new users are "user").
 */
export const store = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw errors.unauthenticated();

    const name = clip(identity.name, NAME_MAX);
    const email = clip(identity.email, EMAIL_MAX);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email, updatedAt: Date.now() });
      }
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      name,
      email,
      role: "user",
      isTrustedLender: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const current = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: roleValidator,
      isTrustedLender: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isTrustedLender: user.isTrustedLender,
    };
  },
});

/** Admin-only member directory (email is shown so admins can identify accounts). */
export const listForAdmin = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireAdmin(ctx);
    const page = await ctx.db.query("users").order("desc").paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isTrustedLender: user.isTrustedLender,
        createdAt: user.createdAt,
      })),
    };
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), isTrustedLender: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, isTrustedLender }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw errors.notFound("User");
    if (target.isTrustedLender !== isTrustedLender) {
      await ctx.db.patch(userId, { isTrustedLender, updatedAt: Date.now() });
    }
    return null;
  },
});

/**
 * Trusted administrative mechanism: internal functions are not reachable from
 * browsers, only from the Convex dashboard or CLI:
 *   npx convex run users:setRole '{"clerkId":"user_xxx","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { clerkId: v.string(), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, { clerkId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user) throw errors.notFound("User (they must sign in once first)");
    await ctx.db.patch(user._id, { role, updatedAt: Date.now() });
    return null;
  },
});
