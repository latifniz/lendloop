"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";
import { z } from "zod";

const convexUrl = z.url().safeParse(process.env.NEXT_PUBLIC_CONVEX_URL);
// A single client per browser tab; it is created lazily so a missing URL
// renders a readable setup error instead of crashing the whole app shell.
const convex = convexUrl.success ? new ConvexReactClient(convexUrl.data) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">LendLoop is not configured</p>
        <p className="mt-1">
          NEXT_PUBLIC_CONVEX_URL is missing or invalid. Run <code>npx convex dev</code> and copy the deployment URL into
          .env.local (see the README).
        </p>
      </div>
    );
  }
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
