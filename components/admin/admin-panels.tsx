"use client";

import { Activity, Handshake, History, Package, ShieldCheck, Users } from "lucide-react";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChips } from "@/components/shared/filter-chips";
import { PaginatedSection } from "@/components/shared/paginated-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";
import { formatDateRange, formatTimestamp } from "@/lib/utils/format";

export function AdminListings() {
  const { results, status, loadMore } = usePaginatedQuery(api.tools.listForAdmin, {}, { initialNumItems: 15 });
  const remove = useSafeMutation(api.tools.remove, { successMessage: "Listing removed" });
  return (
    <PaginatedSection
      results={results}
      status={status}
      loadMore={loadMore}
      getKey={(tool) => tool._id}
      empty={<EmptyState icon={Package} title="No listings" description="Nothing has been listed yet." />}
      renderItem={(tool) => (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{tool.name}</p>
            <p className="text-xs text-muted-foreground">{tool.category} · by {tool.ownerName} · {formatTimestamp(tool.createdAt)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={tool.status} />
            {tool.status !== "removed" ? (
              <ConfirmDialog
                trigger={<Button size="sm" variant="outline">Remove</Button>}
                title={`Remove “${tool.name}”?`}
                description="This hides the listing from everyone and closes its pending requests. Existing loans are kept."
                confirmLabel="Remove listing"
                destructive
                pending={remove.pending}
                onConfirm={() => remove.run({ toolId: tool._id })}
              />
            ) : null}
          </div>
        </Card>
      )}
    />
  );
}

export function AdminMembers() {
  const { results, status, loadMore } = usePaginatedQuery(api.users.listForAdmin, {}, { initialNumItems: 20 });
  const setTrusted = useSafeMutation(api.users.setTrustedLender, { successMessage: "Lender status updated" });
  return (
    <PaginatedSection
      results={results}
      status={status}
      loadMore={loadMore}
      getKey={(user) => user._id}
      empty={<EmptyState icon={Users} title="No members" description="Members appear here after they sign in." />}
      renderItem={(user) => (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{user.name ?? "Unnamed member"} {user.role === "admin" ? <Badge tone="blue">Admin</Badge> : null}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email ?? "No email"}</p>
          </div>
          <Button
            size="sm"
            variant={user.isTrustedLender ? "outline" : "primary"}
            disabled={setTrusted.pending}
            aria-pressed={user.isTrustedLender}
            onClick={() => setTrusted.run({ userId: user._id, isTrustedLender: !user.isTrustedLender })}
          >
            <ShieldCheck className="size-3.5" aria-hidden /> {user.isTrustedLender ? "Remove trusted" : "Mark trusted"}
          </Button>
        </Card>
      )}
    />
  );
}

type LoanFilter = "all" | "active" | "overdue" | "returned";
const LOAN_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "overdue", label: "Overdue" },
  { value: "returned", label: "Returned" },
] as const;

export function AdminLoans() {
  const [filter, setFilter] = useState<LoanFilter>("all");
  const { results, status, loadMore } = usePaginatedQuery(api.loans.listForAdmin, filter === "all" ? {} : { status: filter }, { initialNumItems: 15 });
  return (
    <>
      <FilterChips label="Filter loans" options={LOAN_FILTERS} value={filter} onChange={setFilter} />
      <PaginatedSection
        results={results}
        status={status}
        loadMore={loadMore}
        getKey={(loan) => loan._id}
        empty={<EmptyState icon={Handshake} title="No loans" description="No loans match this filter." />}
        renderItem={(loan) => (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{loan.toolName}</p>
                <p className="text-xs text-muted-foreground">{loan.lenderName} → {loan.borrowerName} · {formatDateRange(loan.startDate, loan.endDate)}</p>
              </div>
              <StatusBadge status={loan.status} />
            </div>
          </Card>
        )}
      />
    </>
  );
}

type AutomationFilter = "all" | "failed" | "processing" | "sent";
const AUTOMATION_FILTERS = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
  { value: "sent", label: "Sent" },
] as const;

export function AdminAutomation() {
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const { results, status, loadMore } = usePaginatedQuery(api.automation.listRecent, filter === "all" ? {} : { status: filter }, { initialNumItems: 20 });
  const retry = useSafeMutation(api.automation.retryFailed, { successMessage: "Retry queued" });
  return (
    <>
      <FilterChips label="Filter automation events" options={AUTOMATION_FILTERS} value={filter} onChange={setFilter} />
      <PaginatedSection
        results={results}
        status={status}
        loadMore={loadMore}
        getKey={(event) => event._id}
        empty={<EmptyState icon={Activity} title="No automation activity" description="Notifications, reminders and workflow errors will be listed here." />}
        renderItem={(event) => (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{event.eventType}</p>
                <p className="break-all text-xs text-muted-foreground">{event.eventKey}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTimestamp(event.createdAt)} · {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                  {event.errorCode ? ` · ${event.errorCode}` : ""}
                  {event.workflowName ? ` · ${event.workflowName} #${event.executionId ?? "?"}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Correlation: <code>{event.correlationId}</code></p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge status={event.status} />
                {event.canRetry ? (
                  <Button size="sm" variant="outline" disabled={retry.pending} onClick={() => retry.run({ eventId: event._id })}>Retry</Button>
                ) : null}
              </div>
            </div>
          </Card>
        )}
      />
    </>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  "tool.removed_by_admin": "Removed a listing",
  "user.trusted_lender_changed": "Changed a lender's trusted status",
  "user.role_changed": "Changed a member's role",
  "automation.retry_requested": "Retried a failed notification",
};

export function AdminAudit() {
  const { results, status, loadMore } = usePaginatedQuery(api.audit.listRecent, {}, { initialNumItems: 20 });
  return (
    <PaginatedSection
      results={results}
      status={status}
      loadMore={loadMore}
      getKey={(entry) => entry._id}
      empty={<EmptyState icon={History} title="No admin actions yet" description="Removals, role and trust changes and notification retries are recorded here." />}
      renderItem={(entry) => (
        <Card className="p-4">
          <p className="font-medium">{AUDIT_LABELS[entry.action] ?? entry.action}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            By {entry.actorName} · {entry.targetType} <code className="break-all text-xs">{entry.targetId}</code>
            {entry.detail ? ` · ${entry.detail}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{formatTimestamp(entry.createdAt)}</p>
        </Card>
      )}
    />
  );
}
