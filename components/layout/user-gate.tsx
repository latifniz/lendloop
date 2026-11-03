"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";

type SyncState = { kind: "syncing" } | { kind: "ready" } | { kind: "failed"; error: unknown };

/**
 * Renders children only once the signed-in Clerk user has an application user
 * record in Convex. `users.store` takes no arguments: identity is read from the
 * verified token on the server.
 */
export function UserGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const [state, setState] = useState<SyncState>({ kind: "syncing" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    storeUser({})
      .then(() => !cancelled && setState({ kind: "ready" }))
      .catch((error: unknown) => !cancelled && setState({ kind: "failed", error }));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, storeUser, attempt]);

  if (isLoading || (isAuthenticated && state.kind === "syncing")) return <LoadingState rows={2} label="Preparing your account" />;
  if (!isAuthenticated) {
    return (
      <ErrorState error={{ data: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } }} />
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="space-y-3">
        <ErrorState error={state.error} />
        <Button
          onClick={() => {
            setState({ kind: "syncing" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
