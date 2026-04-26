// Project Dashboard sub-tab — Story 04 implementation (PRD §11.5).
//
// Replaces the S03 placeholder. Composes 5 focal-column modules + the
// meta sidebar in a CSS grid. The data is fetched server-side via
// `caller.projectRoom.dashboard({ projectId })` in page.tsx and
// passed in as the `dashboard` prop — this component is a pure render
// of that payload, no client-side data fetching.
//
// Why server-fetched (vs the architecture-doc's client React-Query
// pattern): the repo doesn't ship that hook layer (S03's agent
// surfaced this). The codebase pattern is server-component data
// fetching via `caller.X.Y(...)` in page.tsx, then passing data down
// as props. This keeps the Dashboard tab consistent with the existing
// Music / Sessions / Money sub-tabs.
//
// Layout: lg:grid-cols-12 with focal column at lg:col-span-7 and
// meta sidebar at lg:col-span-5 (sticky-top). Mobile collapses to a
// single column with the meta sidebar's chip strip rendered above the
// focal modules.

import { HeaderStrip } from "../dashboard/header-strip";
import { LatestVersionStrip } from "../dashboard/latest-version-strip";
import { MetaSidebar } from "../dashboard/meta-sidebar";
import { OpenCommentsList } from "../dashboard/open-comments-list";
import { RecentActivityFeed } from "../dashboard/recent-activity-feed";
import { WhatsNext } from "../dashboard/whats-next";
import type {
  ActivityEvent,
  WhatsNextSignal,
} from "../dashboard/dashboard-helpers";
import type { LatestVersion } from "../dashboard/latest-version-strip";
import type { MetaSidebarData } from "../dashboard/meta-sidebar";
import type { OpenCommentRow } from "../dashboard/open-comments-list";

// Mirrors the projectRoom.dashboard procedure return shape (project-
// room.ts). Re-declared here so the page.tsx server caller and the
// component agree on the prop shape without round-tripping through
// TRPCRouter inference plumbing.
export interface DashboardData {
  projectId: string;
  projectTitle: string;
  artistName: string;
  artistAvatarUrl: string | null;
  stage: MetaSidebarData["stage"];
  latestVersion: LatestVersion | null;
  whatsNext: WhatsNextSignal | null;
  recentActivity: ActivityEvent[];
  openComments: OpenCommentRow[];
  sidebar: MetaSidebarData;
}

export function DashboardSubTab({
  projectId,
  dashboard,
}: {
  projectId: string;
  dashboard: DashboardData;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
      {/* Focal column — 7/12 on desktop, full width on mobile. */}
      <div className="flex flex-col gap-4 lg:col-span-7">
        <HeaderStrip
          artistName={dashboard.artistName}
          artistAvatarUrl={dashboard.artistAvatarUrl}
          projectTitle={dashboard.projectTitle}
          stage={dashboard.stage}
        />
        <LatestVersionStrip
          latestVersion={dashboard.latestVersion}
          projectId={projectId}
        />
        <WhatsNext signal={dashboard.whatsNext} />
        <RecentActivityFeed events={dashboard.recentActivity} />
        <OpenCommentsList
          comments={dashboard.openComments}
          projectId={projectId}
        />
      </div>

      {/* Meta sidebar — 5/12 right rail on desktop, sticky-top so it
          stays visible while the focal column scrolls. On mobile it
          collapses to a chip strip rendered above the focal column;
          MetaSidebar handles both layouts internally with the lg:
          breakpoint, so we render it once. */}
      <aside className="lg:col-span-5 lg:sticky lg:top-4 lg:self-start">
        <MetaSidebar sidebar={dashboard.sidebar} projectId={projectId} />
      </aside>
    </div>
  );
}
