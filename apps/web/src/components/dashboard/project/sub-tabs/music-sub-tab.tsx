"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useMemo, useState, useTransition } from "react";

import { AudioUploader } from "~/components/audio/audio-uploader";
import { WaveformPlayer } from "~/components/audio/waveform-player";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { fmtDateTime } from "~/lib/time/relative";
import {
  addProjectTrack,
  addProducerComment,
  addTrackVersion,
  approveVersionAction,
  resolveVersionComment,
} from "~/app/(app)/dashboard/projects/actions";

// MusicSubTab only needs the project ID to scope its queries and
// action calls — version/track/comment data comes in via the `tracks`
// prop. The broader Project shape (stage, artistName, payment fields)
// belongs on the ProjectHeader, not here.
interface ProjectRef {
  id: string;
}

interface Track {
  id: string;
  title: string;
  artist: string | null;
  position: number;
}

interface Version {
  id: string;
  trackId: string;
  label: string;
  audioUrl: string | null;
  uploadedAt: Date;
  approvedAt: Date | null;
}

interface CommentRow {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  timestampMs: number;
  resolvedAt: Date | null;
  fromProducer: boolean;
  createdAt: Date;
}

// Timestamp formatter used inside waveform comments. fmtDateTime lives
// in ~/lib/time/relative.ts — Task 9 consolidated the duplicated copies
// from the four Project Room sub-tabs there.
function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

// Rough "x ago" string for the approved badge. We only care about this
// at coarse resolution (the user's sense of "is this recent?"), so
// rounding to the nearest unit is fine.
function fmtAgo(d: Date): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  const days = Math.floor(h / 24);
  return `${String(days)}d ago`;
}

// Detect whether a sibling version looks like a stems upload so we
// don't nag the producer with the "Stems?" prompt after they've
// already sent them. Heuristic: the label OR the audio URL contains
// the word "stem". Case-insensitive. `stems.zip` / `stems (final)` /
// `mix + stems` all match.
export function hasStemsSibling(
  approvedId: string,
  siblingVersions: { id: string; label: string; audioUrl: string | null }[],
): boolean {
  const re = /stems?/i;
  return siblingVersions.some(
    (v) =>
      v.id !== approvedId && (re.test(v.label) || (v.audioUrl !== null && re.test(v.audioUrl))),
  );
}

// ─── Main ────────────────────────────────────────────────────────────
// Task 6: the old inner "Audio" tab inside ProjectView is now the outer
// Music sub-tab's entire body. Rendered directly by page.tsx when
// `tab === "music"`, no longer via ProjectView.
export function MusicSubTab({
  project,
  tracks,
  versions,
  comments,
}: {
  project: ProjectRef;
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [showTrack, setShowTrack] = useState(false);
  const [newTrackTitle, setNewTrackTitle] = useState("");
  const [newTrackArtist, setNewTrackArtist] = useState("");

  const [versionFor, setVersionFor] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState("");

  const initialSelected = useMemo(
    () =>
      Object.fromEntries(
        tracks.map((t) => {
          const latest = versions.find((v) => v.trackId === t.id);
          return [t.id, latest?.id ?? null];
        }),
      ),
    [tracks, versions],
  );
  const [selected, setSelected] = useState<Record<string, string | null>>(initialSelected);

  function onCreateTrack(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = newTrackTitle.trim();
    if (!title) return;
    startTransition(async () => {
      const res = await addProjectTrack({
        projectId: project.id,
        title,
        ...(newTrackArtist.trim() ? { artist: newTrackArtist.trim() } : {}),
      });
      if (res.ok) {
        toast(`Track "${title}" added.`, "success");
        setNewTrackTitle("");
        setNewTrackArtist("");
        setShowTrack(false);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onCreateVersion(e: SyntheticEvent<HTMLFormElement>, trackId: string) {
    e.preventDefault();
    const label = newVersionLabel.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await addTrackVersion({ projectId: project.id, trackId, label, audioUrl: null });
      if (res.ok) {
        toast(`Version "${label}" added — drop your file to upload.`, "success");
        setNewVersionLabel("");
        setVersionFor(null);
        setSelected((s) => ({ ...s, [trackId]: res.data.id }));
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  function onResolve(id: string, resolved: boolean) {
    startTransition(async () => {
      const res = await resolveVersionComment({ projectId: project.id, id, resolved });
      if (res.ok) {
        toast(resolved ? "Comment resolved." : "Re-opened.", "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <section
      role="tabpanel"
      id="panel-music"
      aria-labelledby="tab-music"
      className="space-y-6"
    >
      {tracks.length === 0 ? (
        <EmptyState
          title="No tracks yet."
          description="Add the first track to start collecting versions + feedback. Use the + Add track button below to name it — you can upload a WAV right after."
        />
      ) : null}

      {tracks.map((t, idx) => {
        const tVersions = versions.filter((v) => v.trackId === t.id);
        const selectedId = selected[t.id] ?? tVersions[0]?.id ?? null;
        const selectedVersion = tVersions.find((v) => v.id === selectedId) ?? tVersions[0] ?? null;
        const cmts = selectedVersion
          ? comments.filter((c) => c.versionId === selectedVersion.id)
          : [];
        return (
          <article
            key={t.id}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
          >
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Track {String(idx + 1).padStart(2, "0")}
                </p>
                <h3
                  className="mt-1 font-display text-xl tracking-tight"
                  style={{ fontWeight: 700 }}
                >
                  {t.title}
                </h3>
                {t.artist ? (
                  <p className="mt-0.5 text-sm text-[rgb(var(--fg-secondary))]">{t.artist}</p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setVersionFor((v) => (v === t.id ? null : t.id));
                }}
                disabled={pending}
              >
                + Version
              </Button>
            </header>

            {tVersions.length > 0 ? (
              <div className="sk-scroll-x mb-4 flex gap-2 overflow-x-auto pb-1">
                {tVersions.map((v, vi) => {
                  const isSelected = v.id === selectedId;
                  const isLatest = vi === 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelected((s) => ({ ...s, [t.id]: v.id }));
                      }}
                      className={[
                        "inline-flex min-h-[44px] items-center whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1 font-mono text-xs transition-colors sm:min-h-0",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                        isSelected
                          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                      ].join(" ")}
                    >
                      {v.label}
                      {isLatest ? " · latest" : ""}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mb-4 text-sm text-[rgb(var(--fg-secondary))]">
                No versions yet. Add the first one with + Version.
              </p>
            )}

            {selectedVersion ? (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3">
                {selectedVersion.audioUrl ? (
                  <WaveformPlayer src={selectedVersion.audioUrl} label={t.title} />
                ) : (
                  <AudioUploader
                    trackVersionId={selectedVersion.id}
                    onComplete={() => {
                      toast("Upload complete.", "success");
                      router.refresh();
                    }}
                  />
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                    <span className="text-[rgb(var(--fg-secondary))]">{selectedVersion.label}</span>
                    {" · "}
                    {selectedVersion.audioUrl
                      ? `uploaded ${fmtDateTime(selectedVersion.uploadedAt)}`
                      : "upload pending"}
                  </p>
                  <ApproveControl
                    projectId={project.id}
                    version={selectedVersion}
                    siblings={tVersions}
                  />
                </div>
              </div>
            ) : null}

            {versionFor === t.id ? (
              <form
                onSubmit={(e) => {
                  onCreateVersion(e, t.id);
                }}
                className="mb-4 grid gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 sm:grid-cols-[1fr_auto_auto]"
              >
                <div>
                  <Label htmlFor={`label-${t.id}`}>Label</Label>
                  <Input
                    id={`label-${t.id}`}
                    type="text"
                    value={newVersionLabel}
                    onChange={(e) => {
                      setNewVersionLabel(e.target.value);
                    }}
                    placeholder="Mix v2"
                    required
                    maxLength={40}
                    autoFocus
                  />
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? "…" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setVersionFor(null);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </form>
            ) : null}

            {selectedVersion ? (
              <div className="space-y-3">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {cmts.length === 0
                    ? "No comments yet"
                    : `${String(cmts.length)} comment${cmts.length === 1 ? "" : "s"}`}
                </p>
                {cmts.map((c) => (
                  <div
                    key={c.id}
                    className={[
                      "rounded-[var(--radius-md)] border px-3 py-2",
                      c.resolvedAt
                        ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] opacity-60"
                        : c.fromProducer
                          ? "border-[rgb(var(--brand-accent)/0.35)] bg-[rgb(var(--brand-accent)/0.06)]"
                          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[rgb(var(--brand-primary))]">
                          {formatMs(c.timestampMs)}
                        </span>
                        <span className="text-xs text-[rgb(var(--fg-secondary))]">
                          {c.authorName}
                        </span>
                        {c.fromProducer ? <Badge variant="accent">You</Badge> : null}
                        {c.resolvedAt ? (
                          <Badge variant="active" dot>
                            Resolved
                          </Badge>
                        ) : null}
                      </div>
                      {c.resolvedAt ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onResolve(c.id, false);
                          }}
                          disabled={pending}
                        >
                          Re-open
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onResolve(c.id, true);
                          }}
                          disabled={pending}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">{c.body}</p>
                  </div>
                ))}
                <ProducerReplyForm
                  projectId={project.id}
                  versionId={selectedVersion.id}
                  onDone={() => {
                    router.refresh();
                  }}
                />
              </div>
            ) : null}
          </article>
        );
      })}

      {!showTrack ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setShowTrack(true);
          }}
        >
          + Add track
        </Button>
      ) : (
        <form
          onSubmit={onCreateTrack}
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="newTrackTitle">Title</Label>
              <Input
                id="newTrackTitle"
                type="text"
                value={newTrackTitle}
                onChange={(e) => {
                  setNewTrackTitle(e.target.value);
                }}
                placeholder="Midnight Drive"
                required
                maxLength={120}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="newTrackArtist">Artist (optional)</Label>
              <Input
                id="newTrackArtist"
                type="text"
                value={newTrackArtist}
                onChange={(e) => {
                  setNewTrackArtist(e.target.value);
                }}
                placeholder="feat. Someone"
                maxLength={120}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "…" : "Add track"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowTrack(false);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ProducerReplyForm({
  projectId,
  versionId,
  onDone,
}: {
  projectId: string;
  versionId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [timestampSec, setTimestampSec] = useState("0");

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    const secs = Math.max(0, Number(timestampSec) || 0);
    startTransition(async () => {
      const res = await addProducerComment({
        projectId,
        versionId,
        body: text,
        timestampMs: Math.round(secs * 1000),
      });
      if (res.ok) {
        toast("Reply posted.", "success");
        setBody("");
        setTimestampSec("0");
        onDone();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-3 sm:grid-cols-[6rem_1fr_auto]"
    >
      <Input
        type="number"
        step={1}
        min={0}
        value={timestampSec}
        onChange={(e) => {
          setTimestampSec(e.target.value);
        }}
        aria-label="Timestamp seconds"
        className="text-right font-mono"
      />
      <Input
        type="text"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        placeholder="Your reply at that timestamp…"
        required
        maxLength={2000}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : "Post"}
      </Button>
    </form>
  );
}

// ─── Approve control ─────────────────────────────────────────────────
// Producer-side "mark this version final". Approving emits a
// notification nudging the producer to upload stems. Once the heuristic
// detects a stems sibling already exists, the "Stems?" link hides (the
// notification is already resolved from the UX's perspective).
function ApproveControl({
  projectId,
  version,
  siblings,
}: {
  projectId: string;
  version: Version;
  siblings: Version[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggle(approved: boolean) {
    startTransition(async () => {
      const res = await approveVersionAction({
        projectId,
        versionId: version.id,
        approved,
      });
      if (res.ok) {
        toast(
          approved
            ? "Version approved — we'll remind you about stems."
            : "Approval cleared.",
          "success",
        );
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  if (!version.approvedAt) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          toggle(true);
        }}
        disabled={pending || !version.audioUrl}
        // If there's no uploaded audio yet the button is disabled —
        // approving a still-uploading version is nonsensical.
        title={version.audioUrl ? "Mark this version as final" : "Upload audio before approving"}
      >
        {pending ? "…" : "Approve"}
      </Button>
    );
  }

  const stemsSibling = hasStemsSibling(version.id, siblings);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="active" dot>
        Approved {fmtAgo(version.approvedAt)}
      </Badge>
      {!stemsSibling ? (
        <span className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
          ·{" "}
          <button
            type="button"
            onClick={() => {
              // Scroll the version uploader into view and nudge the
              // producer to add a "stems" labelled version. Selecting
              // the + Version button focus-wise is more involved;
              // for MVP we simply scroll + toast an instruction.
              toast(
                "Add a new version labelled \"stems\" under this track.",
                "info",
              );
            }}
            className="underline-offset-2 hover:text-[rgb(var(--brand-primary))] hover:underline"
          >
            Stems?
          </button>
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          toggle(false);
        }}
        disabled={pending}
        className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))] underline-offset-2 hover:text-[rgb(var(--fg-primary))] hover:underline"
      >
        Undo
      </button>
    </div>
  );
}
