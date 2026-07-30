import { Skeleton } from "~/components/ui/skeleton";

export default function ProducerSongLoading() {
  return (
    <main
      aria-label="Loading song"
      className="relative min-h-full overflow-x-clip bg-[rgb(var(--bg-background))]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.09)] via-[rgb(var(--bg-background)/0.72)] to-[rgb(var(--bg-background))]"
      />
      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 py-4 pb-24 sm:px-6 sm:py-6 lg:py-8 lg:pb-10">
        <div className="mb-4 grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)] sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-5 sm:p-5">
          <Skeleton className="h-[88px] w-[88px] rounded-[var(--radius-lg)] sm:h-[108px] sm:w-[108px]" />
          <div className="min-w-0 space-y-3 pt-1">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-8 w-3/4 max-w-80" />
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-wrap gap-2 pt-2">
              <Skeleton className="h-11 w-20 rounded-[var(--radius-lg)]" />
              <Skeleton className="h-11 w-28 rounded-[var(--radius-lg)]" />
              <Skeleton className="h-11 w-28 rounded-[var(--radius-lg)]" />
            </div>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
          <Skeleton className="h-[320px] rounded-[var(--radius-xl)] bg-[rgb(var(--bg-sidebar)/0.92)]" />
          <Skeleton className="h-[320px] rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </main>
  );
}
