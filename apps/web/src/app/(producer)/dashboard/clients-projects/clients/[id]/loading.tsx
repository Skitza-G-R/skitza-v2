// Route-segment loading state for /dashboard/clients-projects/clients/[id]
// (Client Space). Mirrors the live single-surface composition: a
// full-bleed dark gradient hero band (avatar + identity + meta + KPIs
// + "+ New project" pill) followed by a vertical list of project rows.
//
// The previous version of this file rendered four fake tab placeholders
// — Phase 1 collapsed the old 4-tab structure (Overview / Projects /
// Payments / Notes) into a single surface, so those tabs no longer
// exist in the real page. Keeping the tabs in the skeleton meant the
// loading state promised UI that never arrives. The dark band uses
// --bg-sunken as a hero stand-in (the per-client hue isn't known on
// first paint).

export default function ClientSpaceLoading() {
  return (
    <main aria-hidden aria-label="Loading client">
      <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10">
        {/* Full-bleed dark hero band (negative horizontal margins
            cancel the page padding, matching the real hero's pattern). */}
        <Skel
          className="-mx-4 h-[300px] sm:-mx-6"
          tone="band"
        />

        {/* Vertical project list — 3 row placeholders */}
        <div className="mt-6 flex flex-col gap-2">
          <Skel className="h-[68px] rounded-[var(--radius-md)]" />
          <Skel className="h-[68px] rounded-[var(--radius-md)]" />
          <Skel className="h-[68px] rounded-[var(--radius-md)]" />
        </div>
      </div>
    </main>
  );
}

function Skel({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "band";
}) {
  const bg =
    tone === "band"
      ? "bg-[rgb(var(--bg-sunken))]"
      : "bg-[rgb(var(--bg-elevated))]";
  return (
    <span
      aria-hidden
      className={[
        "block animate-pulse",
        tone === "band"
          ? ""
          : "border border-[rgb(var(--border-subtle))]",
        bg,
        className ?? "",
      ].join(" ")}
    />
  );
}
