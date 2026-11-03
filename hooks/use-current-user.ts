"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** `undefined` while loading, `null` when signed out or not yet synced. */
export function useCurrentUser() {
  return useQuery(api.users.current);
}
