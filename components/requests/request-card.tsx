"use client";

import { Check, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";
import { formatDateRange, formatTimestamp } from "@/lib/utils/format";
import type { RequestRow } from "@/types";

type Props = { request: RequestRow; perspective: "borrower" | "lender" };

export function RequestCard({ request, perspective }: Props) {
  const approve = useSafeMutation(api.requests.approve, { successMessage: "Approved. A loan has been created." });
  const decline = useSafeMutation(api.requests.decline, { successMessage: "Request declined" });
  const cancel = useSafeMutation(api.requests.cancel, { successMessage: "Request cancelled" });
  const busy = approve.pending || decline.pending || cancel.pending;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{request.toolName}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {perspective === "borrower" ? "Lender" : "Borrower"}: {request.counterpartName}
            {request.counterpartIsTrusted ? <Badge tone="green">Trusted</Badge> : null}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Dates</dt><dd>{formatDateRange(request.startDate, request.endDate)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Requested</dt><dd>{formatTimestamp(request.createdAt)}</dd></div>
      </dl>
      {request.message ? (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm"><span className="sr-only">Message: </span>“{request.message}”</p>
      ) : null}

      {request.status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {perspective === "lender" ? (
            <>
              <ConfirmDialog
                trigger={<Button size="sm" disabled={busy}><Check className="size-3.5" aria-hidden /> Approve</Button>}
                title="Approve this request?"
                description={`${request.counterpartName} will be able to borrow ${request.toolName} for ${formatDateRange(request.startDate, request.endDate)}. We'll re-check that those dates are still free.`}
                confirmLabel="Approve"
                pending={approve.pending}
                onConfirm={() => approve.run({ requestId: request._id })}
              />
              <ConfirmDialog
                trigger={<Button size="sm" variant="outline" disabled={busy}><X className="size-3.5" aria-hidden /> Decline</Button>}
                title="Decline this request?"
                description={`${request.counterpartName} will be told their request was declined.`}
                confirmLabel="Decline"
                destructive
                pending={decline.pending}
                onConfirm={() => decline.run({ requestId: request._id })}
              />
            </>
          ) : (
            <ConfirmDialog
              trigger={<Button size="sm" variant="outline" disabled={busy}>Cancel request</Button>}
              title="Cancel this request?"
              description="The lender will be told you no longer need the tool."
              confirmLabel="Cancel request"
              destructive
              pending={cancel.pending}
              onConfirm={() => cancel.run({ requestId: request._id })}
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}
