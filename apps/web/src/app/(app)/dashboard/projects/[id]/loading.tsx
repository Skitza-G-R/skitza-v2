import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/deals/[id]. This page
// awaits a full deal detail payload — tracks, versions, comments, the
// contract summary — which can be slow on cold Neon connections.
// Rendering a skeleton immediately avoids the bare-white flash that
// otherwise shows between click and hydration.
export default function DealDetailLoading() {
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))]">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-[2fr,1fr]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </div>
  );
}
