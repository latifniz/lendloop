import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { errors } from "./errors";

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

/**
 * Private records answer NOT_FOUND to non-participants rather than FORBIDDEN so
 * that guessing document ids reveals nothing, not even that the id exists.
 */
export async function requireToolOwner(
  ctx: DbCtx,
  actor: Doc<"users">,
  toolId: Id<"tools">,
): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.status === "removed") throw errors.notFound("Tool");
  if (tool.ownerId !== actor._id) throw errors.forbidden("Only the owner can change this listing.");
  return tool;
}

export type RequestRole = "borrower" | "lender";

export async function requireBorrowerOrLender(
  ctx: DbCtx,
  actor: Doc<"users">,
  requestId: Id<"borrowRequests">,
): Promise<{ request: Doc<"borrowRequests">; role: RequestRole }> {
  const request = await ctx.db.get(requestId);
  if (!request) throw errors.notFound("Request");
  if (request.borrowerId === actor._id) return { request, role: "borrower" };
  if (request.lenderId === actor._id) return { request, role: "lender" };
  throw errors.notFound("Request");
}

export async function requireLender(
  ctx: DbCtx,
  actor: Doc<"users">,
  requestId: Id<"borrowRequests">,
): Promise<Doc<"borrowRequests">> {
  const { request, role } = await requireBorrowerOrLender(ctx, actor, requestId);
  if (role !== "lender") throw errors.forbidden("Only the lender can do that.");
  return request;
}

export async function requireBorrower(
  ctx: DbCtx,
  actor: Doc<"users">,
  requestId: Id<"borrowRequests">,
): Promise<Doc<"borrowRequests">> {
  const { request, role } = await requireBorrowerOrLender(ctx, actor, requestId);
  if (role !== "borrower") throw errors.forbidden("Only the borrower can do that.");
  return request;
}

export async function requireLoanParticipant(
  ctx: DbCtx,
  actor: Doc<"users">,
  loanId: Id<"loans">,
): Promise<{ loan: Doc<"loans">; role: RequestRole }> {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw errors.notFound("Loan");
  if (loan.borrowerId === actor._id) return { loan, role: "borrower" };
  if (loan.lenderId === actor._id) return { loan, role: "lender" };
  throw errors.notFound("Loan");
}
