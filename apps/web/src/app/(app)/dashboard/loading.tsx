import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/*. Shown during navigation
// or when the Server Component is awaiting its data. Matches the real
// page's layout so the transition is minimal perceptual shift.
export default function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))]">
      {/* Mirror the app shell header — same 56px-ish height + same
          border so the real shell swap-in is imperceptible. */}
      <div className="h-[57px] border-b border-[rgb(var(--border-subtle))]" />
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[rgb(var(--brand-primary)/0.45)] to-transparent" />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  );
}
