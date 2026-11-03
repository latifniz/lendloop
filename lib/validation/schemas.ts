import { z } from "zod";
import { MS_PER_DAY, REQUEST_LIMITS, TOOL_CATEGORIES, TOOL_CONDITIONS, TOOL_LIMITS } from "../constants";

/**
 * Control characters (except tab/newline) have no place in listing text and can
 * corrupt emails or logs downstream, so they are rejected rather than stripped.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const cleanText = (label: string, max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => !CONTROL_CHARS.test(value), `${label} contains invalid characters`);

export const toolInputSchema = z.object({
  name: cleanText("Name", TOOL_LIMITS.nameMax, 2).refine((value) => !/[\r\n]/.test(value), "Name must be a single line"),
  category: z.enum(TOOL_CATEGORIES, { message: "Choose a category" }),
  condition: z.enum(TOOL_CONDITIONS, { message: "Choose a condition" }),
  description: cleanText("Description", TOOL_LIMITS.descriptionMax, 10),
});
export type ToolInput = z.infer<typeof toolInputSchema>;

/** Dates travel as UTC-midnight epoch milliseconds so that day math is exact. */
const utcDay = z
  .number()
  .int("Date is invalid")
  .refine((value) => Number.isSafeInteger(value) && value % MS_PER_DAY === 0, "Date must be a whole day");

export const requestInputSchema = z.object({
  startDate: utcDay,
  endDate: utcDay,
  message: z
    .string()
    .trim()
    .max(REQUEST_LIMITS.messageMax, `Message must be at most ${REQUEST_LIMITS.messageMax} characters`)
    .refine((value) => !CONTROL_CHARS.test(value), "Message contains invalid characters")
    .optional(),
});
export type RequestInput = z.infer<typeof requestInputSchema>;
