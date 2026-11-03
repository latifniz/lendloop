"use client";

import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginatedSection } from "@/components/shared/paginated-section";
import { OwnToolCard } from "@/components/tools/own-tool-card";
import { Button } from "@/components/ui/button";

export default function MyListingsPage() {
  const { results, status, loadMore } = usePaginatedQuery(api.tools.listMine, {}, { initialNumItems: 12 });
  const addButton = (
    <Button asChild>
      <Link href="/tools/new"><Plus className="size-4" aria-hidden /> Add a tool</Link>
    </Button>
  );
  return (
    <>
      <PageHeader title="My listings" description="Tools you've shared with the neighborhood." actions={addButton} />
      <PaginatedSection
        layout="grid"
        results={results}
        status={status}
        loadMore={loadMore}
        getKey={(tool) => tool._id}
        renderItem={(tool) => <OwnToolCard tool={tool} />}
        empty={<EmptyState icon={Package} title="You haven't listed anything yet" description="Share a tool you rarely use. It only takes a minute." action={addButton} />}
      />
    </>
  );
}
