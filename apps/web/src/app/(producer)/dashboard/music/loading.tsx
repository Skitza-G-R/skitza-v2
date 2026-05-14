import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/music. Shown during
// navigation while the cross-project library page awaits its
// `producer.music.list` result. Renders a short skeleton column that
// mirrors the real list's shape (rows of title + meta) so the
// perceptual shift when the data lands is minimal.
export default function MusicLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mt-10 space-y-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[rgb(var(--border-subtle))] pb-3 last:border-b-0 last:pb-0"
          >
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
