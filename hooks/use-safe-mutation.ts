"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getUserMessage } from "@/lib/utils/app-error";

export type MutationOutcome<Result> = { ok: true; value: Result } | { ok: false; error: string };

/**
 * Wraps a Convex mutation with: duplicate-submission protection (a second call
 * while one is in flight is ignored), a pending flag, safe error messages, and
 * optional success feedback. Errors never expose server internals.
 */
export function useSafeMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  options: { successMessage?: string; silent?: boolean } = {},
) {
  const execute = useMutation(mutation);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const { successMessage, silent } = options;

  const run = useCallback(
    async (args: FunctionArgs<Mutation>): Promise<MutationOutcome<FunctionReturnType<Mutation>>> => {
      if (inFlight.current) return { ok: false, error: "Another action is still in progress." };
      inFlight.current = true;
      setPending(true);
      try {
        const value = await execute(args);
        if (successMessage) toast.success(successMessage);
        return { ok: true, value };
      } catch (error) {
        const message = getUserMessage(error);
        if (!silent) toast.error(message);
        return { ok: false, error: message };
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [execute, successMessage, silent],
  );

  return { run, pending };
}
