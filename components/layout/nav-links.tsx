"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS } from "./nav-items";

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  // "/tools" must not light up for "/tools/mine"; pick the longest matching item.
  const longest = NAV_ITEMS.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return longest?.href === href;
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const summary = useQuery(api.dashboard.summary);
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "admin");

  return (
    <nav aria-label="Main" className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const count = item.badge === "incoming" ? (summary?.incomingPendingRequests ?? 0) : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-primary-soft text-primary" : "text-stone-700 hover:bg-muted",
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {count > 0 ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-white" aria-label={`${count} pending`}>
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
