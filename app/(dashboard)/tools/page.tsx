"use client";

import { Search } from "lucide-react";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChips } from "@/components/shared/filter-chips";
import { PageHeader } from "@/components/shared/page-header";
import { PaginatedSection } from "@/components/shared/paginated-section";
import { ToolCard } from "@/components/tools/tool-card";
import { TOOL_CATEGORIES } from "@/lib/constants";

const OPTIONS = [{ value: "all", label: "All categories" }, ...TOOL_CATEGORIES.map((category) => ({ value: category, label: category }))] as const;

export default function BrowseToolsPage() {
  const [category, setCategory] = useState<string>("all");
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.listBrowse,
    category === "all" ? {} : { category },
    { initialNumItems: 12 },
  );

  return (
    <>
      <PageHeader title="Browse tools" description="Tools your neighbors are happy to lend." />
      <FilterChips label="Filter by category" options={OPTIONS} value={category} onChange={setCategory} />
      <PaginatedSection
        layout="grid"
        results={results}
        status={status}
        loadMore={loadMore}
        getKey={(tool) => tool._id}
        renderItem={(tool) => <ToolCard tool={tool} />}
        empty={<EmptyState icon={Search} title="No tools found" description={category === "all" ? "Nobody has listed a tool yet. Be the first!" : `No ${category} tools are available right now.`} />}
      />
    </>
  );
}
