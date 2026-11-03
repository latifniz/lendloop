"use client";

import { useQuery } from "convex/react";
import { Wrench } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { LoadingState } from "@/components/shared/loading-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

function List() {
  // Public query: returns only { name, category } for each available tool.
  const tools = useQuery(api.tools.listPublic);
  if (tools === undefined) return <LoadingState rows={2} label="Loading available tools" />;
  if (tools.length === 0) {
    return <EmptyState icon={Wrench} title="No tools listed yet" description="Be the first neighbor to share a tool. Sign in and add a listing." />;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool, index) => (
        <li key={`${index}-${tool.name}`}>
          <Card className="flex items-center justify-between gap-3 p-4">
            <span className="font-medium">{tool.name}</span>
            <Badge>{tool.category}</Badge>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function PublicToolList() {
  return (
    <ErrorBoundary>
      <List />
    </ErrorBoundary>
  );
}
