"use client";

import { PageHeader } from "@/components/shared/page-header";
import { RequestList } from "@/components/requests/request-list";

export default function IncomingRequestsPage() {
  return (
    <>
      <PageHeader title="Incoming requests" description="Neighbors who'd like to borrow your tools." />
      <RequestList perspective="lender" />
    </>
  );
}
