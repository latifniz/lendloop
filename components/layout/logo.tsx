import Link from "next/link";
import { Repeat2 } from "lucide-react";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span className="rounded-lg bg-primary p-1.5 text-white">
        <Repeat2 className="size-4" aria-hidden />
      </span>
      <span className="text-lg">LendLoop</span>
    </Link>
  );
}
