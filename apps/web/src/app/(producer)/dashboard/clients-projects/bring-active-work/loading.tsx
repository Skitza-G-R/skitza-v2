import { Skeleton } from "~/components/ui/skeleton";

export default function BringActiveWorkLoading() {
  return (
    <main className="mx-auto flex max-w-[1600px] flex-col px-3 pt-2 pb-28 sm:px-5 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:px-6 lg:pb-4">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[rgb(var(--border-subtle))] pb-2.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-44 max-w-full" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-11 w-28 sm:w-40" />
      </div>
      <div className="mt-3 grid min-w-0 gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(22rem,0.96fr)_minmax(0,1.44fr)]">
        <Skeleton className="h-[34rem] rounded-[var(--radius-lg)] lg:h-full" />
        <Skeleton className="hidden h-[38rem] rounded-[var(--radius-lg)] lg:block lg:h-full" />
      </div>
    </main>
  );
}
