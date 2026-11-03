"use client";

import { ErrorState } from "@/components/shared/error-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-6">
      <ErrorState error={error} onRetry={reset} />
    </main>
  );
}
