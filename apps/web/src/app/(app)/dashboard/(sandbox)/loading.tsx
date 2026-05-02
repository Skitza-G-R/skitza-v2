import { Skeleton } from "~/components/ui/skeleton";

// Loading state for sandbox routes. Lives INSIDE (sandbox)/layout.tsx,
// which means the real Sidebar (and FloatingPlayer + Cmd-K palette)
// stay mounted while this skeleton fills only the {children} slot.
//
// Previously loading.tsx mocked a sidebar because every page ALSO
// owned its own DesignShell that unmounted on nav. After hoisting the
// shell into the layout, the sidebar is preserved across navigation —
// so this skeleton only needs to cover the main content area.
export default function SandboxLoading() {
  return (
    <div style={{ flex: 1, padding: "clamp(16px, 3vw, 32px)" }}>
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
    </div>
  );
}
