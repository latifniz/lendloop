"use client";

import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/shared/page-header";
import { ToolForm } from "@/components/tools/tool-form";
import { Card } from "@/components/ui/card";
import { useSafeMutation } from "@/hooks/use-safe-mutation";

export default function NewToolPage() {
  const router = useRouter();
  const { run, pending } = useSafeMutation(api.tools.create, { successMessage: "Tool listed. Thanks for sharing!" });
  return (
    <>
      <PageHeader title="Add a tool" description="Tell neighbors what you can lend." />
      <Card className="max-w-2xl p-6">
        <ToolForm
          submitLabel="List tool"
          pending={pending}
          onSubmit={async (values) => {
            const outcome = await run(values);
            if (outcome.ok) router.push("/tools/mine");
          }}
        />
      </Card>
    </>
  );
}
