import { Skeleton } from "~/components/ui/skeleton";

export default function ArtistSongLoading() {
  return (
    <div className="-mx-4 -mt-6 min-h-dvh bg-[rgb(var(--bg-sidebar))] px-4 pt-4 text-white lg:mx-0 lg:mt-0 lg:min-h-0 lg:bg-[rgb(var(--bg-background))] lg:p-4">
      <div className="mx-auto grid max-w-[1480px] lg:h-[calc(100dvh-114px)] lg:min-h-[680px] lg:grid-cols-[minmax(0,1.82fr)_minmax(330px,1fr)] lg:gap-4">
        <section className="flex min-w-0 flex-col">
          <div className="flex min-h-11 items-center justify-between">
            <Skeleton className="h-4 w-40 bg-white/10 lg:bg-[rgb(var(--fg-default)/0.07)]" />
            <Skeleton className="h-11 w-11 rounded-full bg-white/10 lg:bg-[rgb(var(--fg-default)/0.07)]" />
          </div>

          <div className="flex flex-col items-center gap-5 pt-4 pb-5 lg:flex-row lg:items-start">
            <Skeleton className="aspect-square w-[min(calc(100vw-48px),420px)] rounded-[12px] bg-white/10 lg:h-[132px] lg:w-[132px] lg:bg-[rgb(var(--fg-default)/0.07)]" />
            <div className="w-full space-y-3 pt-1">
              <Skeleton className="mx-auto h-8 w-2/3 bg-white/10 lg:mx-0 lg:bg-[rgb(var(--fg-default)/0.07)]" />
              <Skeleton className="mx-auto h-4 w-32 bg-white/10 lg:mx-0 lg:bg-[rgb(var(--fg-default)/0.07)]" />
              <Skeleton className="mx-auto h-11 w-40 rounded-[var(--radius-lg)] bg-white/10 lg:mx-0 lg:bg-[rgb(var(--fg-default)/0.07)]" />
            </div>
          </div>

          <div className="flex min-h-[238px] flex-1 flex-col justify-center rounded-[12px] border border-white/[0.08] bg-[rgb(28_26_20)] px-4 py-6">
            <Skeleton className="h-24 w-full bg-white/[0.08]" />
            <div className="mt-6 flex justify-center gap-8">
              <Skeleton className="h-12 w-12 rounded-full bg-white/[0.08]" />
              <Skeleton className="h-[68px] w-[68px] rounded-full bg-[rgb(var(--brand-primary)/0.35)]" />
              <Skeleton className="h-12 w-12 rounded-full bg-white/[0.08]" />
            </div>
          </div>
        </section>

        <aside className="hidden min-h-0 rounded-[12px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 lg:block">
          <div className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] pb-4">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-10" />
          </div>
          <div className="space-y-5 py-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="border-b border-[rgb(var(--border-subtle))] pb-5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-3 w-full" />
                <Skeleton className="mt-1.5 h-3 w-3/4" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-auto h-12 w-full rounded-[12px]" />
        </aside>
      </div>
    </div>
  );
}
