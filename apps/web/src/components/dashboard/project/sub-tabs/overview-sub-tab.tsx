// Project Room — Overview tab. The "album page" landing surface that
// summarizes everything the producer cares about at a glance:
//   • Workflow card: the existing 5-step <ProjectTimeline/> rail
//     (stage progression — Trial → Contract → In Progress → Final →
//     Paid). Per the 2026-05 spec we reuse the existing component
//     rather than reinventing a vertical stages list.
//   • Latest songs card: top 3 most-recently-updated tracks with a
//     link out to the Songs sub-tab.
//   • Client card: contact name, email, and any CRM tags from the
//     client_contacts row that matched on artistEmail.
//
// Server component on purpose — every subcomponent here is pure
// formatting; no hooks, no client interactivity. Reduces hydration
// cost on the default landing tab.

import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { ProjectTimeline } from "~/components/dashboard/project/project-timeline";
import type { ProjectTimelineInput } from "~/components/dashboard/project/timeline-helpers";
import { fmtDateTime } from "~/lib/time/relative";

export interface OverviewLatestSong {
  trackId: string;
  title: string;
  // Most recent version label ("Mix v3", "Master v1") for this track,
  // or null when the track has no versions yet (a producer can create
  // a track row before uploading audio).
  latestVersionLabel: string | null;
  latestUploadedAt: Date | null;
}

export interface OverviewClient {
  name: string;
  email: string;
  // CRM tags from client_contacts. Empty array if no tags or no
  // matching contact row.
  tags: string[];
}

interface OverviewSubTabProps {
  projectId: string;
  timeline: ProjectTimelineInput;
  latestSongs: OverviewLatestSong[];
  trackCount: number;
  client: OverviewClient;
  // Pre-rendered <TagEditor/> element (a client component). Passed as
  // a slot so the Overview tab itself can stay a server component
  // — RSC interleaves the client subtree without forcing the parent
  // to become "use client". Pass null when there's no client_contacts
  // row for this project (legacy rows / mid-migration); the card then
  // falls back to read-only Badges or an empty hint.
  tagEditor?: React.ReactNode | null;
}

export function OverviewSubTab({
  projectId,
  timeline,
  latestSongs,
  trackCount,
  client,
  tagEditor,
}: OverviewSubTabProps) {
  return (
    <section
      role="tabpanel"
      id="panel-overview"
      aria-labelledby="tab-overview"
      // Three columns at desktop, single column at mobile. minmax keeps
      // the cards from collapsing under their padding when content is
      // short (e.g. a project with no tracks).
      className="grid grid-cols-1 gap-3 lg:grid-cols-3"
    >
      <Card title="Workflow">
        <ProjectTimeline {...timeline} />
      </Card>

      <Card
        title="Latest songs"
        action={
          trackCount > 0 ? (
            <Link
              href={`/dashboard/projects/${projectId}?tab=music`}
              scroll={false}
              className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
            >
              See all
            </Link>
          ) : null
        }
      >
        {latestSongs.length === 0 ? (
          <EmptyHint>
            No songs uploaded yet.{" "}
            <Link
              href={`/dashboard/projects/${projectId}?tab=music`}
              scroll={false}
              className="text-[rgb(var(--brand-primary))] underline-offset-2 hover:underline"
            >
              Upload first track →
            </Link>
          </EmptyHint>
        ) : (
          <ul className="flex flex-col">
            {latestSongs.map((song) => (
              <li key={song.trackId}>
                <Link
                  href={`/dashboard/projects/${projectId}?tab=music`}
                  scroll={false}
                  className="sk-row flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm transition-colors"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))]">
                    <SongIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[rgb(var(--fg-primary))]">
                      {song.title}
                    </span>
                    <span className="block truncate text-[0.72rem] text-[rgb(var(--fg-muted))]">
                      {song.latestVersionLabel
                        ? `${song.latestVersionLabel}${
                            song.latestUploadedAt
                              ? ` · ${fmtDateTime(song.latestUploadedAt)}`
                              : ""
                          }`
                        : "No versions yet"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Client">
        <div className="flex flex-col gap-3 px-2 py-1">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-base))] font-mono text-xs font-semibold text-[rgb(var(--fg-secondary))]"
            >
              {computeInitials(client.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-[rgb(var(--fg-primary))]">
                {client.name}
              </div>
              <div className="truncate text-[0.72rem] text-[rgb(var(--fg-muted))]">
                {client.email}
              </div>
            </div>
          </div>
          {tagEditor !== undefined && tagEditor !== null ? (
            // Client-component slot — interactive autocomplete + add/
            // remove. Pre-rendered by the orchestrator (server page)
            // and dropped in here unchanged.
            tagEditor
          ) : client.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {client.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[0.72rem] text-[rgb(var(--fg-muted))]">
              No tags yet — add them from the contacts page.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}

// ─── Card primitive ──────────────────────────────────────────────────

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-card flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="label-tiny">{title}</h2>
        {action}
      </header>
      <div>{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 py-3 text-sm text-[rgb(var(--fg-muted))]">{children}</p>
  );
}

function SongIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx={6} cy={18} r={3} />
      <circle cx={18} cy={16} r={3} />
    </svg>
  );
}

// Initials computed the same way as ProjectHeader's avatar — keeps
// the visual signal consistent across surfaces. Two-character max.
function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "??";
}
