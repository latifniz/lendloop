"use client";

import { Handshake } from "lucide-react";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterChips } from "@/components/shared/filter-chips";
import { PageHeader } from "@/components/shared/page-header";
import { PaginatedSection } from "@/components/shared/paginated-section";
import { LoanCard } from "@/components/loans/loan-card";

const ROLE_OPTIONS = [
  { value: "borrower", label: "Borrowing" },
  { value: "lender", label: "Lending" },
] as const;

export default function MyLoansPage() {
  const [role, setRole] = useState<"borrower" | "lender">("borrower");
  const { results, status, loadMore } = usePaginatedQuery(api.loans.listMine, { role }, { initialNumItems: 10 });
  return (
    <>
      <PageHeader title="My loans" description="Tools you've borrowed and tools you've lent out." />
      <FilterChips label="Loan role" options={ROLE_OPTIONS} value={role} onChange={setRole} />
      <PaginatedSection
        results={results}
        status={status}
        loadMore={loadMore}
        getKey={(loan) => loan._id}
        renderItem={(loan) => <LoanCard loan={loan} />}
        empty={<EmptyState icon={Handshake} title={role === "borrower" ? "You haven't borrowed anything yet" : "Nothing is out on loan"} description={role === "borrower" ? "Approved requests turn into loans here." : "When you approve a request, the loan is tracked here until it's returned."} />}
      />
    </>
  );
}
