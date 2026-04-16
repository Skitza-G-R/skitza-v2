import { Skeleton } from "~/components/ui/skeleton";

// Public portfolio skeleton. Matches the atmospheric hero layout so
// the transition to the real content feels like the page is breathing
// in rather than flashing.
export default function PortfolioLoading() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 top-[-8rem] h-[40rem] w-[40rem] rounded-full bg-[rgb(var(--brand-primary)/0.14)] blur-[140px]" />
      </div>
      <main className="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-14 sm:px-10 sm:pt-20">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="mt-8 h-24 w-3/4" />
        <div className="mt-8 h-px w-16 bg-[rgb(var(--brand-primary))]" />
        <div className="mt-14 flex flex-col divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-5 py-6 sm:gap-8">
              <Skeleton className="h-12 w-12 sm:h-20 sm:w-20" />
              <Skeleton className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-10 w-full max-w-md" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
