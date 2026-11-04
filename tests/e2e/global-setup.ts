import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY || !(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY)) {
    throw new Error("E2E needs CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (a Clerk development instance).");
  }
  process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  await clerkSetup();
}
