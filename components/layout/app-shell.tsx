"use client";

import { UserButton } from "@clerk/nextjs";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { UserGate } from "./user-gate";

function ProfileBlock() {
  const user = useCurrentUser();
  return (
    <div className="flex items-center gap-3">
      <UserButton />
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{user?.name ?? "Your account"}</p>
        <p className="text-xs capitalize text-muted-foreground">{user?.role === "admin" ? "Administrator" : "Member"}</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <UserGate>
      <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-border bg-white lg:flex lg:flex-col lg:p-4">
        <div className="mb-6 px-2">
          <Logo href="/dashboard" />
        </div>
        <div className="flex-1">
          <NavLinks />
        </div>
        <div className="border-t border-border pt-4">
          <ProfileBlock />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3 lg:hidden">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-2">
            <UserButton />
            <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Open menu">
                  <Menu className="size-4" aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent side="left">
                <DialogTitle className="mb-4 px-2">
                  <Logo href="/dashboard" />
                </DialogTitle>
                <NavLinks onNavigate={() => setMenuOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
      </div>
    </UserGate>
  );
}
