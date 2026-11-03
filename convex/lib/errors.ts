import { ConvexError } from "convex/values";
import type { AppErrorCode, AppErrorData } from "../../lib/utils/app-error";

export function appError(code: AppErrorCode, message: string): ConvexError<AppErrorData> {
  return new ConvexError({ code, message });
}

export const errors = {
  unauthenticated: () => appError("UNAUTHENTICATED", "Please sign in to continue."),
  forbidden: (message = "You do not have permission to do that.") => appError("FORBIDDEN", message),
  notFound: (what: string) => appError("NOT_FOUND", `${what} was not found.`),
  conflict: (message: string) => appError("CONFLICT", message),
  invalidState: (message: string) => appError("INVALID_STATE", message),
  validation: (message: string) => appError("VALIDATION", message),
};
