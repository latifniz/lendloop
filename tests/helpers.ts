import { convexTest } from "convex-test";
import { vi } from "vitest";
import { MS_PER_DAY } from "../lib/constants";
import { startOfUtcDay } from "../lib/utils/dates";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.*s");

export type TestConvex = ReturnType<typeof createTestConvex>;
export type UserHandle = Awaited<ReturnType<typeof createUser>>;

export const FIXED_NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

/** Fake timers keep scheduled outbox jobs from running unless a test opts in. */
export function useFixedClock(): void {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
}

export function createTestConvex() {
  return convexTest(schema, modules);
}

export function dayOffset(days: number): number {
  return startOfUtcDay(FIXED_NOW) + days * MS_PER_DAY;
}

export async function createUser(t: TestConvex, key: string, name = key) {
  const asUser = t.withIdentity({
    subject: `user_${key}`,
    name,
    email: `${key}@example.test`,
    issuer: "https://clerk.example.test",
  });
  const id = await asUser.mutation(api.users.store, {});
  return { id, asUser, clerkId: `user_${key}` };
}

export async function makeAdmin(t: TestConvex, user: UserHandle): Promise<void> {
  await t.mutation(internal.users.setRole, { clerkId: user.clerkId, role: "admin" });
}

export const VALID_TOOL = {
  name: "Cordless drill",
  category: "Power tools",
  condition: "Good",
  description: "18V drill with two batteries and a bit set.",
};

export async function createTool(owner: UserHandle, overrides: Partial<typeof VALID_TOOL> = {}): Promise<Id<"tools">> {
  return await owner.asUser.mutation(api.tools.create, { ...VALID_TOOL, ...overrides });
}

export async function createRequest(
  borrower: UserHandle,
  toolId: Id<"tools">,
  startOffset = 2,
  endOffset = 5,
): Promise<Id<"borrowRequests">> {
  return await borrower.asUser.mutation(api.requests.create, {
    toolId,
    startDate: dayOffset(startOffset),
    endDate: dayOffset(endOffset),
    message: "Weekend project",
  });
}

export const PAGE = { numItems: 50, cursor: null } as const;
