import type { z } from "zod";
import { errors } from "./errors";

/** Parses untrusted input and converts the first issue into a safe validation error. */
export function parseOrThrow<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw errors.validation(result.error.issues[0]?.message ?? "Invalid input.");
}
