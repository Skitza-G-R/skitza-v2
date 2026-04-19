import Link from "next/link";

// Server Component — pure projection of one project row from
// artist.music.projects. The whole card is a single <Link>, no
// interactivity needed at this level (the project detail page
// handles play/comment/etc. in Task 9).
//
// We intentionally don't pull in artworkUrl yet — the placeholder
// square is dead chrome. When projects gain cover art, swap the
// `<div … bg-sunken …/>` for an <Image>.
export function ProjectCard({
  project,
}: {
  project: {
    projectId: string;
    title: string;
    producerName: string;
    latestTrackTitle: string | null;
    latestTrackUploadedAt: Date | null;
    trackCount: number;
  };
}) {
  return (
    <Link
      href={`/artist/music/${project.projectId}`}
      className="flex items-center gap-3 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 transition-colors hover:border-[rgb(var(--brand-primary))]/50"
    >
      <div
        className="h-14 w-14 shrink-0 rounded-sm bg-[rgb(var(--bg-sunken))]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{project.title}</p>
        <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
          {project.producerName}
          {project.latestTrackTitle
            ? ` · ${project.latestTrackTitle}`
            : " · No tracks yet"}
        </p>
      </div>
      <span className="font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {project.trackCount} {project.trackCount === 1 ? "track" : "tracks"}
      </span>
    </Link>
  );
}
