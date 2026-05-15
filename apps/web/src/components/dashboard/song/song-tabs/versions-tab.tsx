"use client";

import { AddVersionDropZone } from "~/components/dashboard/song/add-version-drop-zone";
import {
  VersionRow,
  type VersionRowVersionData,
} from "~/components/dashboard/song/version-row";

// VersionsTab — full version history for the Song Space (DESIGN.md
// §4.4, BUILD-NOTES §5.4.2). First row is the slim AddVersionDropZone
// — Phase 3 ships it disabled; Phase 4 wires the Upload Track modal.
// Below the drop zone, every version is rendered as a VersionRow,
// newest-first (the parent passes the list in display order).

interface VersionsTabProps {
  song: { title: string };
  project: { name: string };
  versions: VersionRowVersionData[];
}

export function VersionsTab({ song, project, versions }: VersionsTabProps) {
  return (
    <section
      role="tabpanel"
      id="panel-versions"
      aria-labelledby="tab-versions"
      className="space-y-1.5"
    >
      {/* Add-version drop zone — always rendered as the first row. */}
      <AddVersionDropZone />

      {versions.length === 0 ? (
        <p
          className="rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-[13px]"
          style={{
            borderColor: "rgb(var(--border-subtle))",
            color: "rgb(var(--fg-muted))",
          }}
        >
          No versions yet — upload the first one to get started.
        </p>
      ) : (
        versions.map((v) => (
          <VersionRow
            key={v.id}
            version={v}
            songTitle={song.title}
            projectName={project.name}
          />
        ))
      )}
    </section>
  );
}
