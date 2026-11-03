import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { errors } from "./errors";

type AuthCtx = Pick<QueryCtx | MutationCtx, "auth" | "db">;

/**
 * Resolves the caller from the verified Clerk JWT. The browser never supplies a
 * user id, so there is nothing for an attacker to forge.
 */
export async function getAuthenticatedUser(ctx: AuthCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireAuthenticatedUser(ctx: AuthCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw errors.unauthenticated();
  const user = await getAuthenticatedUser(ctx);
  // A valid session without a stored user means sync has not completed yet.
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function requireAdmin(ctx: AuthCtx): Promise<Doc<"users">> {
  const user = await requireAuthenticatedUser(ctx);
  if (user.role !== "admin") throw errors.forbidden("Administrator access is required.");
  return user;
}

const FALLBACK_DISPLAY_NAME = "LendLoop neighbor";

/** The only user attribute other members ever see (never email or Clerk id). */
export function publicDisplayName(user: { name?: string } | null): string {
  return user?.name?.trim() || FALLBACK_DISPLAY_NAME;
}
