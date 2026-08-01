export default function AlbumSpaceLoading() {
  return (
    <div
      aria-hidden
      className="sk-page-enter mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6"
      style={{ animationFillMode: "backwards" }}
    >
      <div className="rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)] sm:p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Skel className="h-3 w-24 rounded-[var(--radius-sm)]" />
            <Skel className="mt-3 h-9 w-2/3 max-w-[420px] rounded-[var(--radius-md)]" />
            <div className="mt-4 flex flex-wrap gap-3">
              <Skel className="h-5 w-28 rounded-[var(--radius-sm)]" />
              <Skel className="h-5 w-20 rounded-[var(--radius-sm)]" />
              <Skel className="h-5 w-24 rounded-[var(--radius-sm)]" />
            </div>
          </div>
          <Skel className="h-11 w-11 shrink-0 rounded-full" />
        </div>
      </div>

      <div className="sticky top-0 z-30 mt-3 bg-[rgb(var(--bg-background)/0.94)] py-2 backdrop-blur-xl lg:top-16">
        <div className="flex max-w-full gap-1 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1">
          <Skel slot="project-tab" className="h-11 w-24 shrink-0 rounded-[var(--radius-lg)]" />
          <Skel slot="project-tab" className="h-11 w-24 shrink-0 rounded-[var(--radius-lg)]" />
          <Skel slot="project-tab" className="h-11 w-28 shrink-0 rounded-[var(--radius-lg)]" />
          <Skel slot="project-tab" className="h-11 w-24 shrink-0 rounded-[var(--radius-lg)]" />
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Skel slot="song-row" className="h-[68px] rounded-[var(--radius-lg)]" />
        <Skel slot="song-row" className="h-[68px] rounded-[var(--radius-lg)]" />
        <Skel slot="song-row" className="h-[68px] rounded-[var(--radius-lg)]" />
        <Skel slot="song-row" className="h-[68px] rounded-[var(--radius-lg)]" />
      </div>
    </div>
  );
}

function Skel({ className, slot }: { className?: string; slot?: string }) {
  return (
    <span
      data-loading-slot={slot}
      className={[
        "block animate-pulse border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] motion-reduce:animate-none",
        className ?? "",
      ].join(" ")}
    />
  );
}
