import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type AuditEntry = {
  /** Omit for actions taken from the Convex dashboard/CLI, which have no signed-in user. */
  actor?: Doc<"users">;
  action: Doc<"auditLogs">["action"];
  targetType: Doc<"auditLogs">["targetType"];
  targetId: Id<"tools"> | Id<"users"> | Id<"automationEvents">;
  /** Short, non-personal context such as "role=admin". */
  detail?: string;
};

/** Writes inside the caller's transaction, so the audit row exists if and only if the action committed. */
export async function recordAudit(ctx: MutationCtx, entry: AuditEntry): Promise<void> {
  await ctx.db.insert("auditLogs", {
    actorId: entry.actor?._id,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    detail: entry.detail,
    createdAt: Date.now(),
  });
}
