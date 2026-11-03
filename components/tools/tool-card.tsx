import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDay } from "@/lib/utils/format";
import type { BrowseTool } from "@/types";
import { BorrowRequestDialog } from "./borrow-request-dialog";

export function ToolCard({ tool }: { tool: BrowseTool }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug">{tool.name}</h3>
        <Badge tone="neutral">{tool.category}</Badge>
      </div>
      <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">{tool.description}</p>
      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1"><dt className="sr-only">Condition</dt><dd>Condition: {tool.condition}</dd></div>
        <div className="flex items-center gap-1">
          <dt className="sr-only">Lender</dt>
          <dd className="flex items-center gap-1">
            {tool.isMine ? "You" : tool.ownerName}
            {tool.ownerIsTrusted ? (
              <Badge tone="green" title="Verified by LendLoop admins">
                <ShieldCheck className="size-3" aria-hidden /> Trusted lender
              </Badge>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
        {tool.onLoanUntil !== null ? (
          <Badge tone="amber">On loan until {formatDay(tool.onLoanUntil)}</Badge>
        ) : (
          <Badge tone="green">Available</Badge>
        )}
        {tool.isMine ? (
          <span className="text-xs text-muted-foreground">Your listing</span>
        ) : (
          <BorrowRequestDialog toolId={tool._id} toolName={tool.name} trigger={<Button size="sm">Request to borrow</Button>} />
        )}
      </div>
    </Card>
  );
}
