import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

type Props = { label: string; value: string; href: string; icon: LucideIcon; tone?: "default" | "alert" };

export function DashboardStatCard({ label, value, href, icon: Icon, tone = "default" }: Props) {
  return (
    <Link href={href} className="group block rounded-card">
      <Card className={cn("p-5 transition-colors group-hover:border-stone-300", tone === "alert" && "border-red-200 bg-red-50/50")}>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className={cn("size-4", tone === "alert" ? "text-danger" : "text-primary")} aria-hidden />
        </div>
        <p className={cn("mt-2 text-3xl font-semibold tabular-nums", tone === "alert" && "text-danger")}>{value}</p>
      </Card>
    </Link>
  );
}
