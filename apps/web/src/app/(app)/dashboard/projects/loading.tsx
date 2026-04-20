import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/projects. Shown during
// navigation while `project.listByStage` is in-flight. Mirrors the
// chip filter bar + grouped stage columns the real page renders, so
// the page swap-in avoids a layout jump.
export default function ProjectsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      {/* Stage chip filter strip */}
      <div className="mt-8 flex gap-2 overflow-x-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      {/* Two stage sections, each with a header + 3 rows */}
      <div className="mt-8 space-y-8">
        {Array.from({ length: 2 }).map((_, s) => (
          <div key={s} className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-[rgb(var(--border-subtle))] p-4 last:border-b-0"
                >
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
