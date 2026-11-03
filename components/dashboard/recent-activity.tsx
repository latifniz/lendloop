"use client";

import { useQuery } from "convex/react";
import { BellRing } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/utils/format";

const EVENT_LABELS: Record<string, string> = {
  "request.created": "New borrow request notification",
  "request.approved": "Request approved notification",
  "request.declined": "Request declined notification",
  "request.cancelled": "Request cancelled notification",
  "loan.overdue_reminder": "Overdue loan reminder",
};

export function RecentActivity() {
  const events = useQuery(api.dashboard.recentActivity);
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-medium"><BellRing className="size-4 text-primary" aria-hidden /> Recent notifications</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Automated messages LendLoop sent you.</p>
      <div className="mt-4">
        {events === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. Notifications about your requests and loans will be listed here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p>{EVENT_LABELS[event.eventType] ?? event.eventType}</p>
                  <p className="text-xs text-muted-foreground">{formatTimestamp(event.createdAt)}</p>
                </div>
                <StatusBadge status={event.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
