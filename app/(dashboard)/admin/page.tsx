"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { AdminAudit, AdminAutomation, AdminListings, AdminLoans, AdminMembers } from "@/components/admin/admin-panels";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { FilterChips } from "@/components/shared/filter-chips";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { useCurrentUser } from "@/hooks/use-current-user";

type Tab = "listings" | "members" | "loans" | "automation" | "audit";
const TABS = [
  { value: "listings", label: "Listings" },
  { value: "members", label: "Members" },
  { value: "loans", label: "Loans" },
  { value: "automation", label: "Automation" },
  { value: "audit", label: "Audit log" },
] as const;

export default function AdminPage() {
  const user = useCurrentUser();
  const [tab, setTab] = useState<Tab>("listings");

  if (user === undefined) return <LoadingState rows={2} />;
  // UI courtesy only: every admin query/mutation re-checks the role inside Convex.
  if (user?.role !== "admin") {
    return <EmptyState icon={ShieldAlert} title="Administrators only" description="You don't have access to this area." />;
  }

  return (
    <>
      <PageHeader title="Administration" description="Moderate listings, review loans, manage trusted lenders and monitor automation." />
      <FilterChips label="Admin sections" options={TABS} value={tab} onChange={setTab} />
      <ErrorBoundary key={tab}>
        {tab === "listings" ? <AdminListings /> : null}
        {tab === "members" ? <AdminMembers /> : null}
        {tab === "loans" ? <AdminLoans /> : null}
        {tab === "automation" ? <AdminAutomation /> : null}
        {tab === "audit" ? <AdminAudit /> : null}
      </ErrorBoundary>
    </>
  );
}
