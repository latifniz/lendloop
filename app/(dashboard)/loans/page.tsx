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

type LoanRole = (typeof ROLE_OPTIONS)[number]["value"];

export default function MyLoansPage() {
  const [chosenRole, setChosenRole] = useState<LoanRole | null>(null);
  const borrowing = usePaginatedQuery(api.loans.listMine, { role: "borrower" }, { initialNumItems: 10 });
  const lending = usePaginatedQuery(api.loans.listMine, { role: "lender" }, { initialNumItems: 10 });
  // Until the member picks a tab, open the one that has loans (lenders just approved something).
  const onlyLending = borrowing.status !== "LoadingFirstPage" && borrowing.results.length === 0 && lending.results.length > 0;
  const role: LoanRole = chosenRole ?? (onlyLending ? "lender" : "borrower");
  const { results, status, loadMore } = role === "borrower" ? borrowing : lending;
  return (
    <>
      <PageHeader title="My loans" description="Tools you've borrowed and tools you've lent out." />
      <FilterChips label="Loan role" options={ROLE_OPTIONS} value={role} onChange={setChosenRole} />
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
