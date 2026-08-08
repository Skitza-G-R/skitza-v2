export default function ClientSpaceLoading() {
  return (
    <>
      <p role="status" className="sr-only">
        Loading client space…
      </p>
      <main aria-hidden>
        <div className="mx-auto w-full max-w-[1180px] px-4 pt-4 pb-28 sm:px-6 sm:pt-6 lg:px-8 lg:pt-7 lg:pb-10">
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <Skel className="h-14 w-14 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skel className="h-6 w-40 rounded-[var(--radius-sm)]" />
                <Skel className="mt-2 h-3 w-56 max-w-full rounded-[var(--radius-sm)]" />
              </div>
              <Skel className="h-11 w-11 shrink-0 rounded-full" />
              <Skel className="h-11 w-11 shrink-0 rounded-full" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1">
            <Skel className="h-11 rounded-[var(--radius-lg)]" />
            <Skel className="h-11 rounded-[var(--radius-lg)]" />
            <Skel className="h-11 rounded-[var(--radius-lg)]" />
          </div>

          <div className="mt-4 space-y-2">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <Skel className="h-3 w-16 rounded-[var(--radius-sm)]" />
                <Skel className="mt-2 h-5 w-32 rounded-[var(--radius-sm)]" />
              </div>
              <Skel className="h-9 w-36 rounded-[var(--radius-lg)]" />
            </div>
            <Skel className="h-[76px] rounded-[var(--radius-lg)]" />
            <Skel className="h-[76px] rounded-[var(--radius-lg)]" />
            <Skel className="h-[76px] rounded-[var(--radius-lg)]" />
          </div>
        </div>
      </main>
    </>
  );
}

function Skel({ className }: { className?: string }) {
  return (
    <span
      className={[
        "block animate-pulse border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] motion-reduce:animate-none",
        className ?? "",
      ].join(" ")}
    />
  );
}
