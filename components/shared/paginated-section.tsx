"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { LoadMore } from "./load-more";
import { LoadingState } from "./loading-state";

type Props<Item> = {
  results: Item[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (count: number) => void;
  getKey: (item: Item) => string;
  renderItem: (item: Item) => ReactNode;
  empty: ReactNode;
  layout?: "grid" | "stack";
  pageSize?: number;
};

export function PaginatedSection<Item>({ results, status, loadMore, getKey, renderItem, empty, layout = "stack", pageSize = 12 }: Props<Item>) {
  if (status === "LoadingFirstPage") return <LoadingState />;
  if (results.length === 0) return <>{empty}</>;
  return (
    <>
      <ul className={cn(layout === "grid" ? "grid gap-4 sm:grid-cols-2" : "space-y-3")}>
        {results.map((item) => (
          <li key={getKey(item)}>{renderItem(item)}</li>
        ))}
      </ul>
      <LoadMore status={status} onLoadMore={() => loadMore(pageSize)} />
    </>
  );
}
