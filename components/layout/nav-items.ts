import { Handshake, Inbox, LayoutDashboard, Package, Search, Send, ShieldCheck, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean; badge?: "incoming" };

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tools", label: "Browse Tools", icon: Search },
  { href: "/tools/mine", label: "My Listings", icon: Package },
  { href: "/requests", label: "My Requests", icon: Send },
  { href: "/requests/incoming", label: "Incoming Requests", icon: Inbox, badge: "incoming" },
  { href: "/loans", label: "My Loans", icon: Handshake },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];
