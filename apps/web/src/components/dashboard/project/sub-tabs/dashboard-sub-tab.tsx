// Dashboard sub-tab — Story 03 stub. The real content (5 focal
// modules + meta sidebar — PRD §11.5) lands in S04. This story is
// plumbing-only: introduce the new default tab so S03 ships the
// no-remount + shallow-routing perf win independent of S04's UI work.
//
// S04 will rewrite this component's body. The props shape stays
// minimal (`{ projectId }`) so S04 only changes the render — no
// callers (page.tsx) need to change.
//
// Why a server component here: the panel renders static placeholder
// copy + accepts the projectId prop the parent already has. No client
// hooks needed yet. S04 will likely flip this to a "use client" file
// once it wires interactive controls (morphing CTA, click-jump to
// Music tab, etc.).

import { EmptyState } from "~/components/ui/empty-state";

export function DashboardSubTab({
  projectId,
}: {
  projectId: string;
}) {
  // ProjectId is held for forward-compat with S04 — the placeholder
  // doesn't read it but the prop shape is the contract this story
  // pins so S04 can drop in the real fetch + render without changing
  // the page.tsx integration.
  void projectId;
  return (
    <div className="space-y-6">
      <EmptyState
        title="Dashboard — coming soon"
        description="The Project Dashboard tab lands in Story 04 of the Project Room redesign. It will surface the latest version, what's next, recent activity, open comments, and the meta sidebar in one focal column."
      />
    </div>
  );
}
