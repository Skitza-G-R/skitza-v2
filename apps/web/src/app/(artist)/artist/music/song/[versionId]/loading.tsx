import { Skeleton } from "~/components/ui/skeleton";

export default function ArtistSongLoading() {
  return (
    <div className="relative -mx-4 -mt-6 min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] lg:-mx-10 lg:-mt-10 lg:min-h-0">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.09)] via-[rgb(var(--bg-background)/0.72)] to-[rgb(var(--bg-background))]"
      />
      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 py-4 pb-24 sm:px-6 sm:py-6 lg:py-8 lg:pb-10">
        <div className="relative mb-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)] sm:p-5">
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[108px_minmax(0,1fr)] sm:gap-x-5 lg:grid-cols-[120px_minmax(0,1fr)]">
            <Skeleton className="h-[88px] w-[88px] rounded-[var(--radius-lg)] sm:h-[108px] sm:w-[108px] lg:h-[120px] lg:w-[120px]" />
            <div className="min-w-0 space-y-2 pt-1">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-8 w-3/4 max-w-80" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="absolute top-4 right-4 h-11 w-11 rounded-full sm:top-5 sm:right-5" />
            <div className="col-span-2 mt-4 flex gap-2 lg:col-span-1 lg:col-start-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="col-span-2 mt-4 flex gap-2 lg:col-span-1 lg:col-start-2">
              <Skeleton className="h-11 w-32 rounded-[var(--radius-lg)] lg:h-10 lg:rounded-[var(--radius-md)]" />
              <Skeleton className="h-11 w-32 rounded-[var(--radius-lg)]" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] lg:items-stretch">
          <section className="flex min-w-0 flex-col gap-4">
            <div className="rounded-[var(--radius-xl)] border border-[rgb(var(--fg-onsidebar)/0.1)] bg-[rgb(var(--bg-sidebar))] px-4 py-5 shadow-[var(--shadow-md)] sm:px-5 lg:px-6 lg:py-6">
              <Skeleton className="h-[104px] w-full bg-white/[0.08] motion-safe:from-white/[0.05] motion-safe:via-white/[0.12] motion-safe:to-white/[0.05] lg:h-[142px]" />
              <div className="mt-5 flex items-center justify-center gap-4 sm:gap-6">
                <Skeleton className="h-12 w-12 rounded-full bg-white/[0.08] motion-safe:from-white/[0.05] motion-safe:via-white/[0.12] motion-safe:to-white/[0.05]" />
                <Skeleton className="h-[60px] w-[60px] rounded-full bg-[rgb(var(--brand-primary)/0.4)] motion-safe:from-[rgb(var(--brand-primary)/0.3)] motion-safe:via-[rgb(var(--brand-primary)/0.5)] motion-safe:to-[rgb(var(--brand-primary)/0.3)]" />
                <Skeleton className="h-12 w-12 rounded-full bg-white/[0.08] motion-safe:from-white/[0.05] motion-safe:via-white/[0.12] motion-safe:to-white/[0.05]" />
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)] lg:hidden">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-7 w-8 rounded-[var(--radius-sm)]" />
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="mt-3 h-5 w-52 max-w-full" />
              <Skeleton className="mt-2 h-3 w-full max-w-96" />
            </div>
          </section>

          <aside className="hidden min-h-[360px] rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] lg:block">
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-5 py-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-10" />
            </div>
            <div className="space-y-5 px-5 py-5">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="border-b border-[rgb(var(--border-subtle))] pb-5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-1.5 h-3 w-3/4" />
                </div>
              ))}
            </div>
            <div className="border-t border-[rgb(var(--border-subtle))] p-4">
              <Skeleton className="h-12 w-full rounded-[var(--radius-lg)]" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
