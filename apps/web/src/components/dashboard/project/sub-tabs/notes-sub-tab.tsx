"use client";

import { useMemo } from "react";

import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { fmtDateTime } from "~/lib/time/relative";

// Project Room → Notes tab.
//
// PRD §3.2 (May 2026 polish): the Project Room has 5 tabs — Overview /
// Music / Sessions / Files / Notes. The Notes tab is now the **activity
// feed** for this project: reverse-chronological list of version
// uploads + comments, plus a small read-only client/timeline summary
// for context.
//
// What used to live here:
//   • The 3-stat block (Tracks / Versions / Contracts) — moved to the
//     Overview tab where it belongs as a top-of-page summary.
//   • The mutating stage / payment / cancel controls — already on
//     ProjectHeader's 3-dot menu since Batch G.
//
// What still lives here:
//   1. OverviewSection — read-only client + timeline metadata. Kept
//      because the producer often opens Notes after a notification and
//      wants the "who is this with?" context next to the activity feed
//      without bouncing back to Overview.
//   2. ActivitySection — reverse-chronological feed of version uploads
//      and comments. Project events (contract signed, invoice paid)
//      will slot in here once the project_events table lands.
//
// A free-text private-notes textarea is on the post-launch roadmap —
// not wired in this pass because v3-clean doesn't expose a
// `projects.updateNotes` procedure.
//
// ProjectSubTabs still owns the tab button that controls this panel, so
// the ARIA ids are `panel-notes` / `tab-notes` to match project-sub-tabs.

// Narrow view of a project — only the fields the two sections read. No
// stage / payment / booking fields because the header + other sub-tabs
// own those.
export interface NotesProject {
  clientName: string | null;
  clientEmail: string | null;
  artistName: string;
  artistEmail: string;
  createdAt: Date;
  updatedAt: Date;
}

// Activity items come from the same tracks / versions / comments arrays
// that MusicSubTab consumes. We only need the fields the timeline
// actually renders — notably NOT audioUrl / resolvedAt.
export interface NotesTrack {
  id: string;
  title: string;
}

export interface NotesVersion {
  trackId: string;
  label: string;
  uploadedAt: Date;
}

export interface NotesComment {
  authorName: string;
  body: string;
  timestampMs: number;
  fromProducer: boolean;
  createdAt: Date;
}

export function NotesSubTab({
  project,
  trackCount,
  versionCount,
  tracks,
  versions,
  comments,
}: {
  project: NotesProject;
  trackCount: number;
  versionCount: number;
  tracks: NotesTrack[];
  versions: NotesVersion[];
  comments: NotesComment[];
}) {
  return (
    <section
      role="tabpanel"
      id="panel-notes"
      aria-labelledby="tab-notes"
      className="space-y-10"
    >
      <OverviewSection
        project={project}
        trackCount={trackCount}
        versionCount={versionCount}
      />
      <ActivitySection tracks={tracks} versions={versions} comments={comments} />
    </section>
  );
}

// ─── Overview section ────────────────────────────────────────────────
// Lifted verbatim from project-view.tsx's old OverviewTab. The outer
// <section role="tabpanel"> wrapper is removed (NotesSubTab owns the
// panel now); this renders as a plain <div> so the two sections stack
// inside a single tabpanel.
//
// Task 5 — stage dropdown, cancel-project modal, mark-final flow and
// the confirm-charge modal all moved to the ProjectHeader. Overview is
// now a pure read-only summary; any writes land on the header's 3-dot
// menu instead.
function OverviewSection({
  project,
  trackCount,
  versionCount,
}: {
  project: NotesProject;
  trackCount: number;
  versionCount: number;
}) {
  // The 3-stat strip lives on the Overview tab now. We only keep the
  // numbers around because future "private notes" copy may want to
  // render "X tracks, Y versions" inline as context. For now, ignore
  // them so the lint doesn't fire — the props stay so the page-level
  // call site doesn't need changing yet.
  void trackCount;
  void versionCount;
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Client
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Name</dt>
            <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
              {project.clientName ?? project.artistName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Email</dt>
            <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
              {project.clientEmail ?? project.artistEmail}
            </dd>
          </div>
          {project.clientName && project.clientName !== project.artistName ? (
            <>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist (credited)</dt>
                <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
                  {project.artistName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist email</dt>
                <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
                  {project.artistEmail}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Timeline
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 font-mono text-xs">
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Created</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Last activity</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.updatedAt)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

// ─── Activity section ────────────────────────────────────────────────
// Lifted verbatim from project-view.tsx's old ActivityTab. Same
// <section role="tabpanel"> wrapper removal as OverviewSection.
type ActivityItem =
  | { kind: "version"; at: Date; trackTitle: string; label: string }
  | {
      kind: "comment";
      at: Date;
      authorName: string;
      fromProducer: boolean;
      body: string;
      timestampMs: number;
    };

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

function ActivitySection({
  tracks,
  versions,
  comments,
}: {
  tracks: NotesTrack[];
  versions: NotesVersion[];
  comments: NotesComment[];
}) {
  const trackById = useMemo(() => {
    const m = new Map<string, NotesTrack>();
    for (const t of tracks) m.set(t.id, t);
    return m;
  }, [tracks]);

  const items: ActivityItem[] = useMemo(() => {
    const out: ActivityItem[] = [];
    for (const v of versions) {
      out.push({
        kind: "version",
        at: v.uploadedAt,
        trackTitle: trackById.get(v.trackId)?.title ?? "(unknown track)",
        label: v.label,
      });
    }
    for (const c of comments) {
      out.push({
        kind: "comment",
        at: c.createdAt,
        authorName: c.authorName,
        fromProducer: c.fromProducer,
        body: c.body,
        timestampMs: c.timestampMs,
      });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }, [versions, comments, trackById]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
          Activity
        </h2>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Reverse-chronological feed of uploads and comments on this project.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet."
          description="Upload a mix or get a comment from the artist — it lands here with a timestamp."
        />
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li
              key={`${String(it.at.valueOf())}-${String(i)}`}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {it.kind === "version" ? (
                    <p className="text-sm text-[rgb(var(--fg-primary))]">
                      <span className="font-semibold">New version</span>{" "}
                      <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                        {it.label}
                      </span>{" "}
                      on{" "}
                      <span className="text-[rgb(var(--fg-secondary))]">{it.trackTitle}</span>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-[rgb(var(--fg-primary))]">
                        <span className="font-semibold">{it.authorName}</span>
                        {it.fromProducer ? (
                          <Badge variant="accent" className="ml-2">
                            You
                          </Badge>
                        ) : null}
                        <span className="ml-1 text-[rgb(var(--fg-secondary))]">
                          commented at{" "}
                          <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                            {formatMs(it.timestampMs)}
                          </span>
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{it.body}</p>
                    </>
                  )}
                </div>
                <p className="whitespace-nowrap font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                  {fmtDateTime(it.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
