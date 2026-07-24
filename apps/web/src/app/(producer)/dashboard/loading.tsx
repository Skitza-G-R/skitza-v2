import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/*. Shown during navigation
// or when the Server Component is awaiting its data. Matches the real
// page's layout so the transition is minimal perceptual shift.
export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-label="Loading studio"
      className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-24 sm:px-6 sm:pt-8"
    >
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-3/4 max-w-xl" />
        <Skeleton className="h-4 w-2/3 max-w-lg" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <Skeleton className="h-72" />
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  );
}
