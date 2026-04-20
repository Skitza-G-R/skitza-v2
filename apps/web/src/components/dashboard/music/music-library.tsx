"use client";

import Link from "next/link";

import { EmptyState } from "~/components/ui/empty-state";
import { fmtDateTime, formatRelativeTime } from "~/lib/time/relative";

// Minimal row shape the list renders. Mirrors the server router's
// response shape but converts Date → ISO string so we stay on the
// plain-JSON side of the RSC → client boundary. The server page
// (page.tsx) does the .toISOString() conversion.
export type MusicRow = {
  id: string;
  trackTitle: string;
  label: string;
  projectId: string;
  projectTitle: string;
  clientName: string | null;
  uploadedAtIso: string;
  audioUrl: string | null;
};

// Cross-project library view — one row per track version across every
// project the producer owns, newest-first. Tapping a row deep-links
// into the Project Room's Music sub-tab with the version preselected
// via ?version=<versionId>.
//
// Empty state gets its own panel so a producer with zero uploads sees
// a friendly "nothing yet" prompt instead of a blank page.
export function MusicLibrary({ tracks }: { tracks: MusicRow[] }) {
  if (tracks.length === 0) {
    return <MusicLibraryEmpty />;
  }

  return (
    <div className="mt-6">
      <ul
        role="list"
        className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
      >
        {tracks.map((row) => (
          <MusicRowItem key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────

// Extracted as a named function so unit tests can render it without a
// route. Design-doc copy: prompt producers with the drop-zone hint
// rather than a dry "no data" — a fresh producer needs to know that
// the path to their first track is through any project, not here.
export function MusicLibraryEmpty() {
  return (
    <EmptyState
      className="mt-10"
      icon={<WaveformIcon />}
      title="No audio yet"
      description="Drop a WAV into any project to kick things off. Uploads land here once your first track has a version."
      action={
        <Link
          href="/dashboard/projects"
          className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Open Projects
        </Link>
      }
    />
  );
}

// ─── Row ─────────────────────────────────────────────────────────────

function MusicRowItem({ row }: { row: MusicRow }) {
  const uploadedAt = new Date(row.uploadedAtIso);
  // The Project Room page reads ?tab=music + ?version=<id> off
  // searchParams — our Music sub-tab pre-selects the version via that
  // URL param, so deep-linking here lands the producer on the exact
  // waveform they tapped.
  const href = `/dashboard/projects/${row.projectId}?tab=music&version=${row.id}`;

  // "Artist EP · Alice Records" — fall back to just the title when the
  // project has no client name (legacy rows + producer-as-artist setups).
  const projectLine = row.clientName
    ? `${row.projectTitle} · ${row.clientName}`
    : row.projectTitle;

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
      >
        <PlayIcon />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
                {row.trackTitle}
              </p>
              <span className="shrink-0 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                {row.label}
              </span>
            </div>
            <p
              className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]"
              title={fmtDateTime(uploadedAt)}
            >
              {formatRelativeTime(uploadedAt)}
            </p>
          </div>
          <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">
            {projectLine}
          </p>
        </div>
      </Link>
    </li>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────

function PlayIcon() {
  // Small filled triangle in a muted disc. The list is Samply-flavoured
  // — producers scan down looking for a specific mix — so a play
  // affordance on every row is the primary visual anchor.
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))]"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="currentColor"
        stroke="none"
      >
        <path d="M3.5 2.5v7l6-3.5-6-3.5Z" />
      </svg>
    </span>
  );
}

function WaveformIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14V10" />
      <path d="M8 18V6" />
      <path d="M12 16V8" />
      <path d="M16 19V5" />
      <path d="M20 14V10" />
    </svg>
  );
}
