import { Skeleton } from "~/components/ui/skeleton";

// Route-segment loading state for /dashboard/*. Shown during navigation
// between dashboard tabs while the new server component awaits its data.
//
// IMPORTANT: this skeleton MUST visually match the design-test shell
// (left sidebar + main area) so the swap from real shell → loading.tsx →
// real shell is perceptually invisible. A mismatched layout (e.g. a top
// header on a sidebar app) creates a flash that *feels* like a full page
// reload even though the navigation is a soft RSC swap.
//
// Width 232 + dark background match Sidebar in _design-test/shell.tsx.
export default function DashboardLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        minHeight: "100dvh",
        background: "rgb(var(--bg-base))",
      }}
    >
      {/* Sidebar placeholder — same width + dark fill as the real Sidebar
          so its visual presence is preserved during the loading window. */}
      <aside
        aria-hidden
        style={{
          width: 232,
          flexShrink: 0,
          background: "rgb(var(--bg-sidebar))",
          borderRight: "1px solid rgb(var(--border-sidebar))",
          display: "flex",
          flexDirection: "column",
          padding: "20px 18px",
          gap: 10,
        }}
      >
        <div
          style={{
            height: 22,
            width: 88,
            borderRadius: 6,
            background: "rgba(255,255,255,0.06)",
          }}
        />
        <div
          style={{
            marginTop: 8,
            height: 32,
            borderRadius: 9,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                height: 36,
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
              }}
            />
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, padding: "clamp(16px, 3vw, 32px)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </main>
    </div>
  );
}
