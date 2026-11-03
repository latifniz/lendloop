import { SignInButton, Show } from "@clerk/nextjs";
import { HandHeart, PackageSearch, Repeat2 } from "lucide-react";
import Link from "next/link";
import { PublicToolList } from "@/components/landing/public-tool-list";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

const STEPS = [
  { icon: PackageSearch, title: "List what you can lend", text: "Add the drill, ladder or camping stove that mostly sits in your garage." },
  { icon: HandHeart, title: "Request what you need", text: "Pick dates and send a request. Lenders approve or decline." },
  { icon: Repeat2, title: "Return it, keep the loop going", text: "Mark tools as returned and automatic reminders handle the rest." },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Logo />
          <Show when="signed-in" fallback={<SignInButton mode="modal" forceRedirectUrl="/dashboard"><Button variant="outline" size="sm">Sign in</Button></SignInButton>}>
            <Button asChild size="sm"><Link href="/dashboard">Open dashboard</Link></Button>
          </Show>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <p className="text-sm font-medium text-primary">Neighborhood tool sharing</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Borrow what you need. Lend what you don&apos;t.</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            LendLoop connects neighbors so a tool you use twice a year can help ten people, and you never need to buy a ladder for one afternoon.
          </p>
          <div className="mt-8">
            <Show when="signed-in" fallback={<SignInButton mode="modal" forceRedirectUrl="/dashboard"><Button size="lg">Sign in to lend or borrow</Button></SignInButton>}>
              <Button asChild size="lg"><Link href="/tools">Browse tools</Link></Button>
            </Show>
          </div>
        </section>

        <section aria-labelledby="how" className="border-y border-border bg-white">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <h2 id="how" className="sr-only">How LendLoop works</h2>
            <ol className="grid gap-8 sm:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <div className="mb-3 inline-flex rounded-lg bg-primary-soft p-2 text-primary"><step.icon className="size-5" aria-hidden /></div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="available" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <h2 id="available" className="text-xl font-semibold">Available in the neighborhood</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Sign in to see details, who&apos;s lending and to send a request.</p>
          <PublicToolList />
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">© LendLoop. Borrow what you need. Lend what you don&apos;t.</footer>
    </div>
  );
}
