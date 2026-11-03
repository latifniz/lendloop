/**
 * Error contract shared by Convex (which throws) and the UI (which displays).
 * Convex redacts the message of plain `Error`s in production, so every
 * user-facing failure is thrown as a ConvexError carrying this payload.
 */
export const APP_ERROR_CODES = [
  "VALIDATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_STATE",
  "RATE_LIMITED",
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export type AppErrorData = { code: AppErrorCode; message: string };

export function isAppErrorData(value: unknown): value is AppErrorData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    (APP_ERROR_CODES as readonly string[]).includes(candidate.code)
  );
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/** Maps any thrown value to a message that is safe to show to a user. */
export function getUserMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (isAppErrorData(data)) return data.message;
  }
  return GENERIC_MESSAGE;
}

export function getErrorCode(error: unknown): AppErrorCode | null {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (isAppErrorData(data)) return data.code;
  }
  return null;
}
