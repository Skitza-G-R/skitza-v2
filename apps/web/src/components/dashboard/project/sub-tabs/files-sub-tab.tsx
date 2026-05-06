// Project Room → Files tab.
//
// Pure read-only empty state for v3-clean. The Files surface (project
// deliverables, contracts, attached notes) is on the post-launch
// roadmap; the schema doesn't carry a `project_files` table yet, so
// this tab exists to (a) pin the PRD §3.2 5-tab spec into the URL
// space and (b) telegraph the missing capability with warm copy.
//
// When the Files router lands, the empty-state branch flips into a
// list rendered from the same payload shape — keep this component as
// the entry point so the tab strip never has to change.

import { EmptyState } from "~/components/ui/empty-state";

export function FilesSubTab({ projectId }: { projectId: string }) {
  // projectId is accepted now so the future router-backed branch can
  // scope its query to this project without a prop-shape rename. Mark
  // it referenced via void so the unused-param lint doesn't fire on
  // the current empty-state-only render.
  void projectId;
  return (
    <section
      role="tabpanel"
      id="panel-files"
      aria-labelledby="tab-files"
      className="space-y-6"
    >
      <EmptyState
        icon={<FileIcon />}
        title="Files coming soon."
        description="Contracts, deliverables, and notes you've attached to this project will live here. We're shipping it after the first wave of producers go live."
        className="min-h-[40vh] justify-center"
      />
    </section>
  );
}

function FileIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 1.5h6.5L13 5v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-12a1 1 0 011-1z" />
      <path d="M9 1.5V5h4" />
      <path d="M5 9h6M5 11.5h6M5 6.5h2" />
    </svg>
  );
}
