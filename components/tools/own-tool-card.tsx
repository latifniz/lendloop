"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";
import { formatDay } from "@/lib/utils/format";
import type { OwnTool } from "@/types";

export function OwnToolCard({ tool }: { tool: OwnTool }) {
  const remove = useSafeMutation(api.tools.remove, { successMessage: "Listing removed" });
  const update = useSafeMutation(api.tools.update, { successMessage: "Listing updated" });
  const nextStatus = tool.status === "available" ? "unavailable" : "available";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{tool.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{tool.category} · {tool.condition}</p>
        </div>
        <StatusBadge status={tool.status} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
      {tool.onLoanUntil !== null ? <Badge tone="amber" className="mt-3">On loan until {formatDay(tool.onLoanUntil)}</Badge> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/tools/${tool._id}/edit`}><Pencil className="size-3.5" aria-hidden /> Edit</Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={update.pending}
          onClick={() =>
            update.run({
              toolId: tool._id,
              name: tool.name,
              category: tool.category,
              condition: tool.condition,
              description: tool.description,
              status: nextStatus,
            })
          }
        >
          {tool.status === "available" ? "Pause listing" : "Resume listing"}
        </Button>
        <ConfirmDialog
          trigger={<Button variant="ghost" size="sm" className="text-danger"><Trash2 className="size-3.5" aria-hidden /> Remove</Button>}
          title={`Remove “${tool.name}”?`}
          description="It will disappear from Browse Tools and pending requests for it will be closed. This can't be undone."
          confirmLabel="Remove listing"
          destructive
          pending={remove.pending}
          onConfirm={() => remove.run({ toolId: tool._id })}
        />
      </div>
    </Card>
  );
}
