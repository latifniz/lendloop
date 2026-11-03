"use client";

import { Inbox, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChips } from "@/components/shared/filter-chips";
import { PaginatedSection } from "@/components/shared/paginated-section";
import { Button } from "@/components/ui/button";
import { RequestCard } from "./request-card";

type StatusFilter = "all" | "pending" | "approved" | "declined" | "cancelled";
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function RequestList({ perspective }: { perspective: "borrower" | "lender" }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const args = filter === "all" ? {} : { status: filter };
  // Both hooks always run (rules of hooks); only one is active via "skip".
  const mine = usePaginatedQuery(api.requests.listMine, perspective === "borrower" ? args : "skip", { initialNumItems: 10 });
  const incoming = usePaginatedQuery(api.requests.listIncoming, perspective === "lender" ? args : "skip", { initialNumItems: 10 });
  const result = perspective === "borrower" ? mine : incoming;

  return (
    <>
      <FilterChips label="Filter by status" options={STATUS_OPTIONS} value={filter} onChange={setFilter} />
      <PaginatedSection
        results={result.results}
        status={result.status}
        loadMore={result.loadMore}
        getKey={(request) => request._id}
        renderItem={(request) => <RequestCard request={request} perspective={perspective} />}
        empty={
          perspective === "borrower" ? (
            <EmptyState icon={Send} title="No requests yet" description="Browse the neighborhood's tools and send your first borrow request."
              action={<Button asChild><Link href="/tools">Browse tools</Link></Button>} />
          ) : (
            <EmptyState icon={Inbox} title="No incoming requests" description="When a neighbor asks to borrow one of your tools, it shows up here." />
          )
        }
      />
    </>
  );
}
