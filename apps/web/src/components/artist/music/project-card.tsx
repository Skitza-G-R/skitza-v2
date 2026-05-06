import Link from "next/link";

import { ProducerAvatar } from "../producer-avatar";

// Project card — locked design system (Phase 5).
//
// Server component, pure projection of one project row from
// `artist.music.projects`. Tap-target = full row. The whole card is
// a single <Link> — keep it that way; the project room handles all
// per-track interactions.
//
// Visual: gradient producer avatar + project title (Outfit 700) +
// producer + track count + (optional) latest-track-title ribbon, with
// a JetBrains-Mono track count chip + chevron on the right.

export type ProjectCardData = {
  projectId: string;
  title: string;
  producerName: string;
  latestTrackTitle: string | null;
  latestTrackUploadedAt: Date | null;
  trackCount: number;
};

export function ProjectCard({ project }: { project: ProjectCardData }) {
  const subLine = project.latestTrackTitle
    ? `Latest · ${project.latestTrackTitle}`
    : "No tracks yet";

  return (
    <Link
      href={`/artist/music/${project.projectId}`}
      className="sk-lift grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 lg:grid-cols-[56px_1fr_auto_auto] lg:gap-4 lg:p-4"
    >
      <ProducerAvatar
        name={project.producerName}
        size={44}
        className="lg:hidden"
      />
      <ProducerAvatar
        name={project.producerName}
        size={56}
        className="hidden lg:flex lg:text-base"
      />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-bold leading-tight text-[rgb(var(--fg-default))] lg:text-[16px]">
          {project.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))] lg:text-xs">
          <ProducerAvatar
            name={project.producerName}
            size={14}
            showInitials={false}
            className="rounded-full"
          />
          <span className="truncate">{project.producerName}</span>
          <span aria-hidden className="opacity-60">
            ·
          </span>
          <span className="truncate">{subLine}</span>
        </div>
      </div>
      <span className="rounded-full bg-[rgb(var(--bg-background))] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        {String(project.trackCount)}{" "}
        {project.trackCount === 1 ? "track" : "tracks"}
      </span>
      <span
        aria-hidden
        className="hidden text-[rgb(var(--fg-muted))] lg:block"
      >
        →
      </span>
    </Link>
  );
}
