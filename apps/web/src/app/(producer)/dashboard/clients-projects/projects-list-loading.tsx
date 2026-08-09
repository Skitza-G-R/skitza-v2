export function ProjectsListLoading() {
  return (
    <main
      aria-label="Loading projects"
      aria-busy="true"
      className="sk-page-enter mx-auto w-full max-w-[1400px] px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <Skeleton className="hidden h-3 w-20 sm:block" />
          <Skeleton className="h-9 w-40 sm:mt-2 sm:h-11" />
        </div>
        <Skeleton className="h-11 w-32 rounded-[var(--radius-lg)]" />
      </div>

      <Skeleton className="mt-5 h-11 w-48 rounded-[var(--radius-lg)]" />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-11 w-52 rounded-[var(--radius-lg)]" />
        <Skeleton className="h-11 w-full max-w-[520px] rounded-[var(--radius-lg)]" />
      </div>

      <div className="mt-4 hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
        <div className="grid grid-cols-[30%_24%_18%_18%_10%] border-b border-[rgb(var(--border-subtle))] px-4 py-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            data-loading-slot="project-table-row"
            className="grid min-h-[64px] grid-cols-[30%_24%_18%_18%_10%] items-center border-b border-[rgb(var(--border-subtle))] px-4 last:border-b-0"
          >
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-10 w-10 rounded-full" />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            data-loading-slot="project-mobile-row"
            className="border-b border-[rgb(var(--border-subtle))] p-4 last:border-b-0"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-[var(--radius-sm)] bg-[rgb(var(--border-subtle))] motion-reduce:animate-none ${className}`}
    />
  );
}
