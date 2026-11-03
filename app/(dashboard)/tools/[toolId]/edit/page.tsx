"use client";

import { useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { ToolForm } from "@/components/tools/tool-form";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";

export default function EditToolPage() {
  const router = useRouter();
  const params = useParams<{ toolId: string }>();
  // The id comes from the URL and is untrusted: Convex validates its shape and the
  // server enforces ownership, so a forged id simply errors (NOT_FOUND / FORBIDDEN).
  const toolId = params.toolId as Id<"tools">;
  const tool = useQuery(api.tools.getForEdit, { toolId });
  const { run, pending } = useSafeMutation(api.tools.update, { successMessage: "Listing updated" });

  return (
    <>
      <PageHeader title="Edit listing" />
      <Card className="max-w-2xl p-6">
        {tool === undefined ? (
          <LoadingState rows={2} />
        ) : (
          <ToolForm
            initialValues={{ name: tool.name, category: tool.category, condition: tool.condition, description: tool.description }}
            submitLabel="Save changes"
            pending={pending}
            onSubmit={async (values) => {
              const outcome = await run({ toolId, ...values });
              if (outcome.ok) router.push("/tools/mine");
            }}
          />
        )}
      </Card>
    </>
  );
}
