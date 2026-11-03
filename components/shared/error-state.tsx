"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorCode, getUserMessage } from "@/lib/utils/app-error";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const code = getErrorCode(error);
  const message =
    code === "UNAUTHENTICATED"
      ? "Your session has expired. Please sign in again."
      : code === "FORBIDDEN"
        ? "You do not have access to this page."
        : getUserMessage(error);
  return (
    <div role="alert" className="flex flex-col items-center rounded-card border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertTriangle className="mb-3 size-6 text-danger" aria-hidden />
      <h2 className="font-medium text-red-900">We couldn&apos;t load this</h2>
      <p className="mt-1 max-w-sm text-sm text-red-800">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
