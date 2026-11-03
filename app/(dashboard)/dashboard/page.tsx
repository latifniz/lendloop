"use client";

import { useQuery } from "convex/react";
import { AlertTriangle, Handshake, Inbox, Package, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DashboardStatCard } from "@/components/dashboard/stat-card";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { useCurrentUser } from "@/hooks/use-current-user";

export default function DashboardPage() {
  const user = useCurrentUser();
  const summary = useQuery(api.dashboard.summary);
  const show = (value: number) => (summary && value >= summary.cap ? `${summary.cap}+` : String(value));

  return (
    <>
      <PageHeader title={user?.name ? `Welcome back, ${user.name.split(" ")[0]}` : "Dashboard"} description="Here's what's happening with your tools and loans." />
      {summary === undefined ? (
        <LoadingState rows={2} label="Loading your summary" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardStatCard label="My active listings" value={show(summary.activeListings)} href="/tools/mine" icon={Package} />
          <DashboardStatCard label="My pending requests" value={show(summary.myPendingRequests)} href="/requests" icon={Send} />
          <DashboardStatCard label="Incoming requests" value={show(summary.incomingPendingRequests)} href="/requests/incoming" icon={Inbox} />
          <DashboardStatCard label="Active loans" value={show(summary.activeLoans)} href="/loans" icon={Handshake} />
          <DashboardStatCard label="Overdue loans" value={show(summary.overdueLoans)} href="/loans" icon={AlertTriangle} tone={summary.overdueLoans > 0 ? "alert" : "default"} />
        </div>
      )}
      <div className="mt-6">
        <RecentActivity />
      </div>
    </>
  );
}
