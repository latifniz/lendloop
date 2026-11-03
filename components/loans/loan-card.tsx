"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";
import { cn } from "@/lib/utils/cn";
import { formatDateRange, formatTimestamp } from "@/lib/utils/format";
import type { LoanRow } from "@/types";

export function LoanCard({ loan }: { loan: LoanRow }) {
  const markReturned = useSafeMutation(api.loans.markReturned, { successMessage: "Marked as returned" });
  const isOverdue = loan.status === "overdue";
  const isOpen = loan.status !== "returned";

  return (
    <Card className={cn("p-5", isOverdue && "border-red-300 bg-red-50/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{loan.toolName}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loan.viewerRole === "borrower" ? `Borrowed from ${loan.lenderName}` : `Lent to ${loan.borrowerName}`}
          </p>
        </div>
        <StatusBadge status={loan.status} />
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Loan period</dt><dd>{formatDateRange(loan.startDate, loan.endDate)}</dd></div>
        {loan.returnedAt ? (
          <div><dt className="text-xs text-muted-foreground">Returned</dt><dd className="flex items-center gap-1"><CheckCircle2 className="size-3.5 text-primary" aria-hidden />{formatTimestamp(loan.returnedAt)}</dd></div>
        ) : null}
      </dl>
      {isOverdue ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm font-medium text-red-800">
          <AlertTriangle className="size-4" aria-hidden />
          {loan.daysOverdue === 0 ? "Past its due date" : `${loan.daysOverdue} day${loan.daysOverdue === 1 ? "" : "s"} overdue`}
        </p>
      ) : null}
      {isOpen ? (
        <div className="mt-4 border-t border-border pt-4">
          {loan.viewerRole === "lender" ? (
            <ConfirmDialog
              trigger={<Button size="sm" disabled={markReturned.pending}>Mark as returned</Button>}
              title="Mark this tool as returned?"
              description={`Confirm that ${loan.borrowerName} gave ${loan.toolName} back. This closes the loan.`}
              confirmLabel="Mark as returned"
              pending={markReturned.pending}
              onConfirm={() => markReturned.run({ loanId: loan._id })}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Return the tool to {loan.lenderName}; they&apos;ll confirm it in LendLoop.</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
