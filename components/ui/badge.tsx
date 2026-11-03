import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-stone-200 bg-stone-100 text-stone-700",
      green: "border-emerald-200 bg-emerald-50 text-emerald-800",
      amber: "border-amber-200 bg-amber-50 text-amber-900",
      red: "border-red-200 bg-red-50 text-red-800",
      blue: "border-sky-200 bg-sky-50 text-sky-800",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
