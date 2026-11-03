import { Button } from "@/components/ui/button";

type PaginationStatus = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

export function LoadMore({ status, onLoadMore }: { status: PaginationStatus; onLoadMore: () => void }) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button variant="outline" onClick={onLoadMore} disabled={status === "LoadingMore"}>
        {status === "LoadingMore" ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
