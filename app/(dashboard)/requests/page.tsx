"use client";

import { PageHeader } from "@/components/shared/page-header";
import { RequestList } from "@/components/requests/request-list";

export default function MyRequestsPage() {
  return (
    <>
      <PageHeader title="My requests" description="Tools you've asked to borrow." />
      <RequestList perspective="borrower" />
    </>
  );
}
