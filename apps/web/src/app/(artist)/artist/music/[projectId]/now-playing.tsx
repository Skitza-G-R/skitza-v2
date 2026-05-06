"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { useArtistAudio } from "~/components/artist/artist-audio-context";
import { ProducerAvatar } from "~/components/artist/producer-avatar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "~/components/ui/sheet";
import {
  WaveformPlayer,
  type WaveformPlayerHandle,
} from "~/components/audio/waveform-player";

import { submitTimestampedComment, type AddedComment } from "./actions";

// Song page (project detail) — locked design system (Phase 5).
//
// In-place redesign of the previous flat list. Audio plumbing,
// optimistic comment append, version selection, and the
// `useArtistAudio().requestComment()` flag flow are PRESERVED — only
// the chrome changes.
//
// Layout per track:
//   1. Dark `--bg-sidebar` hero strip — back chevron + producer chip,
//      project eyebrow, Syne title, upload meta, version pills.
//   2. Waveform card pulled up `-mt-3` over the hero edge — transport
//      row + WaveformPlayer (h=70 mobile, h=84 desktop) + dashed
//      "Comment at @X:XX" trigger.
//   3. Gated/live download row.
//   4. Comments thread — eyebrow + cards.
//   5. Composer surface — Sheet (mobile, side="bottom") OR inline
//      panel (desktop, lg+). Same form body in both; visibility
//      controlled by responsive utility classes.
//
// `audio.state.pendingComment` is the single source of truth for "is
// the composer open?" — the existing flag set by `requestComment()`
// flows transparently through both surfaces.

// ─── Types (mirror artist.music.project return shape) ───────────────

type Version = {
  id: string;
  label: string;
  audioUrl: string | null;
  durationMs: number | null;
  uploadedAt: Date;
  peaksR2Key: string | null;
};

type Comment = {
  id: string;
  versionId: string;
  timeMs: number;
  body: string;
  fromProducer: boolean;
  authorName: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

type Track = {
  id: string;
  title: string;
  artist: string | null;
  position: number;
  versions: Version[];
  comments: Comment[];
};

type Session = {
  id: string;
  startsAt: Date;
  durationMin: number;
  status: string;
  packageName: string | null;
};

type NowPlayingData = {
  project: {
    id: string;
    title: string;
    producerId: string;
    producerName: string;
    finalPaid: boolean;
  };
  tracks: Track[];
  sessions: Session[];
};

// ─── Top-level component ────────────────────────────────────────────

export function NowPlaying({ data }: { data: NowPlayingData }) {
  const [selectedVersionByTrack, setSelectedVersionByTrack] = useState<
    Record<string, string>
  >(() => {
    const initial: Record<string, string> = {};
    for (const t of data.tracks) {
      const first = t.versions[0];
      if (first) initial[t.id] = first.id;
    }
    return initial;
  });

  const [optimisticByVersion, setOptimisticByVersion] = useState<
    Record<string, Comment[]>
  >({});

  return (
    <div className="space-y-6 pb-12 lg:space-y-8">
      {/* Page-level back chip — links up to the library. */}
      <div className="flex items-center gap-2">
        <Link
          href="/artist/music"
          className="sk-press inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          <span aria-hidden>←</span>
          <span>Library</span>
        </Link>
      </div>

      {data.tracks.length === 0 ? (
        <EmptyTracksCard producerName={data.project.producerName} />
      ) : (
        <ul className="space-y-8 lg:space-y-12">
          {data.tracks.map((track) => {
            const selectedVersionId =
              selectedVersionByTrack[track.id] ?? track.versions[0]?.id;
            const selectedVersion = track.versions.find(
              (v) => v.id === selectedVersionId,
            );
            const optimistic = selectedVersionId
              ? (optimisticByVersion[selectedVersionId] ?? [])
              : [];
            const serverComments = selectedVersionId
              ? track.comments.filter((c) => c.versionId === selectedVersionId)
              : [];
            const combined = [...serverComments, ...optimistic];

            return (
              <li key={track.id} className="space-y-4 lg:space-y-5">
                <SongCard
                  project={data.project}
                  track={track}
                  selectedVersion={selectedVersion ?? null}
                  onSelectVersion={(id) => {
                    setSelectedVersionByTrack((prev) => ({
                      ...prev,
                      [track.id]: id,
                    }));
                  }}
                  comments={combined}
                  onOptimisticAppend={(c) => {
                    setOptimisticByVersion((prev) => ({
                      ...prev,
                      [c.versionId]: [...(prev[c.versionId] ?? []), c],
                    }));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      {data.sessions.length > 0 ? (
        <SessionsRail sessions={data.sessions} />
      ) : null}
    </div>
  );
}

// ─── One track = one full "song page" card ──────────────────────────

function SongCard({
  project,
  track,
  selectedVersion,
  onSelectVersion,
  comments,
  onOptimisticAppend,
}: {
  project: NowPlayingData["project"];
  track: Track;
  selectedVersion: Version | null;
  onSelectVersion: (id: string) => void;
  comments: Comment[];
  onOptimisticAppend: (c: Comment) => void;
}) {
  return (
    <section
      aria-label={`${track.title} (${selectedVersion?.label ?? "no versions"})`}
      className="overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]"
    >
      <SongHero
        project={project}
        track={track}
        selectedVersion={selectedVersion}
        onSelectVersion={onSelectVersion}
      />
      {selectedVersion ? (
        <SongBody
          project={project}
          track={track}
          version={selectedVersion}
          comments={comments}
          onOptimisticAppend={onOptimisticAppend}
        />
      ) : (
        <div className="px-5 py-10 text-center text-sm text-[rgb(var(--fg-muted))]">
          No versions uploaded yet.
        </div>
      )}
    </section>
  );
}

// ─── Dark hero header per track ─────────────────────────────────────

function SongHero({
  project,
  track,
  selectedVersion,
  onSelectVersion,
}: {
  project: NowPlayingData["project"];
  track: Track;
  selectedVersion: Version | null;
  onSelectVersion: (id: string) => void;
}) {
  return (
    <div
      className="px-5 pb-8 pt-5 text-[rgb(var(--fg-inverse))] lg:px-7 lg:pb-10 lg:pt-6"
      style={{ background: "rgb(var(--bg-sidebar))" }}
    >
      <div className="flex items-center gap-2.5">
        <ProducerAvatar name={project.producerName} size={22} />
        <span className="text-[12px] text-[rgb(var(--fg-inverse)/0.7)]">
          {project.producerName}
        </span>
      </div>

      <p className="mt-4 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
        {project.title}
      </p>
      <h2 className="mt-1.5 font-display text-[26px] font-extrabold leading-[1.05] tracking-tight lg:text-[34px]">
        {track.title}
      </h2>
      {track.artist ? (
        <p className="mt-1 text-[13px] text-[rgb(var(--fg-inverse)/0.7)]">
          {track.artist}
        </p>
      ) : null}

      {selectedVersion ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[11px] text-[rgb(var(--fg-inverse)/0.65)]">
            {formatRelativeDate(selectedVersion.uploadedAt)}
          </span>
          <span aria-hidden className="text-[rgb(var(--fg-inverse)/0.35)]">
            ·
          </span>
          <span className="font-mono text-[11px] text-[rgb(var(--fg-inverse)/0.65)]">
            {formatDuration(selectedVersion.durationMs)}
          </span>
        </div>
      ) : null}

      {track.versions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {track.versions.map((v, i) => {
            const active = v.id === selectedVersion?.id;
            const isLatest = i === 0;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onSelectVersion(v.id);
                }}
                className={
                  active
                    ? "sk-press rounded-full bg-[rgb(var(--brand-primary))] px-3 py-1.5 font-mono text-[11px] font-bold text-[rgb(var(--bg-sidebar))]"
                    : "sk-press rounded-full border border-[rgb(var(--border-sidebar))] bg-[rgb(var(--fg-inverse)/0.08)] px-3 py-1.5 font-mono text-[11px] font-bold text-[rgb(var(--fg-inverse)/0.7)]"
                }
              >
                {v.label}
                {isLatest ? (
                  <span className="ml-1 opacity-60">· latest</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─── Body: waveform card + actions + comments + composer ────────────

function SongBody({
  project,
  track,
  version,
  comments,
  onOptimisticAppend,
}: {
  project: NowPlayingData["project"];
  track: Track;
  version: Version;
  comments: Comment[];
  onOptimisticAppend: (c: Comment) => void;
}) {
  const audio = useArtistAudio();
  const isCurrent = audio.state.currentTrack?.id === version.id;
  const pendingComment =
    isCurrent && audio.state.pendingComment ? audio.state.pendingComment : null;
  const wavesurferRef = useRef<WaveformPlayerHandle | null>(null);

  const handleRequestComment = () => {
    if (!isCurrent && version.audioUrl) {
      audio.playTrack({
        id: version.id,
        url: version.audioUrl,
        title: `${version.label} of ${track.title}`,
        producerName: project.producerName,
        artworkUrl: null,
      });
    }
    audio.requestComment();
  };

  const positionMs = isCurrent
    ? Math.round(audio.state.position * 1000)
    : 0;

  return (
    <>
      {/* Waveform card — pulled up to overlap the dark hero edge. */}
      <div className="-mt-4 px-3 lg:-mt-5 lg:px-5">
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-md)] lg:p-5">
          {version.audioUrl ? (
            <>
              <WaveformPlayer
                ref={wavesurferRef}
                src={version.audioUrl}
                height={70}
                className="lg:hidden"
                label={`${version.label} of ${track.title}`}
                onSeek={(sec) => {
                  audio.setPosition(sec);
                }}
              />
              <WaveformPlayer
                ref={wavesurferRef}
                src={version.audioUrl}
                height={84}
                className="hidden lg:block"
                label={`${version.label} of ${track.title}`}
                onSeek={(sec) => {
                  audio.setPosition(sec);
                }}
              />
              <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-[rgb(var(--fg-muted))]">
                <span>{formatTime(positionMs)}</span>
                <span>{formatDuration(version.durationMs)}</span>
              </div>
            </>
          ) : (
            <div
              className="flex h-20 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] text-xs text-[rgb(var(--fg-muted))]"
              aria-label="No audio uploaded for this version"
            >
              No audio yet
            </div>
          )}

          <button
            type="button"
            onClick={handleRequestComment}
            disabled={!version.audioUrl}
            className="sk-press mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-40"
          >
            <PlusIcon size={14} />
            <span>
              Comment at{" "}
              <span className="font-mono text-[rgb(var(--brand-primary))]">
                {formatTime(positionMs)}
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* Download / gated row */}
      <div className="px-3 pt-4 lg:px-5">
        <DownloadRow
          version={version}
          finalPaid={project.finalPaid}
        />
      </div>

      {/* Comments */}
      <div className="px-3 pb-5 pt-5 lg:px-5 lg:pb-6">
        <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Timestamped feedback · {String(comments.length)}
        </p>
        <CommentList comments={comments} producerName={project.producerName} />
      </div>

      {/* Mobile composer — Sheet */}
      <Sheet
        open={pendingComment !== null}
        onOpenChange={(open) => {
          if (!open) audio.dismissComment();
        }}
      >
        <SheetContent className="lg:hidden">
          <SheetTitle className="sr-only">Add comment</SheetTitle>
          {pendingComment ? (
            <CommentComposer
              version={version}
              timeMs={Math.round(pendingComment.time * 1000)}
              producerName={project.producerName}
              wavesurferRef={wavesurferRef}
              onSubmit={onOptimisticAppend}
              onDismiss={audio.dismissComment}
              variant="sheet"
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Desktop composer — inline panel under the comments */}
      {pendingComment ? (
        <div className="hidden border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 pb-5 pt-5 lg:block">
          <CommentComposer
            version={version}
            timeMs={Math.round(pendingComment.time * 1000)}
            producerName={project.producerName}
            wavesurferRef={wavesurferRef}
            onSubmit={onOptimisticAppend}
            onDismiss={audio.dismissComment}
            variant="inline"
          />
        </div>
      ) : null}
    </>
  );
}

// ─── Download row (gated when finalPaid is false) ───────────────────

function DownloadRow({
  version,
  finalPaid,
}: {
  version: Version;
  finalPaid: boolean;
}) {
  if (!version.audioUrl) return null;

  if (finalPaid) {
    return (
      <a
        href={version.audioUrl}
        download
        className="sk-press flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-inverse))]"
        aria-label={`Download ${version.label}`}
      >
        <DownloadIcon size={14} />
        <span>
          Download {version.label} <span className="opacity-60">· WAV</span>
        </span>
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-warning)/0.15)] text-[rgb(var(--fg-warning))]"
      >
        <LockIcon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
          Download unlocks after final payment
        </p>
        <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
          Once your producer marks the project as paid, the WAV download
          becomes available.
        </p>
      </div>
    </div>
  );
}

// ─── Comments list ──────────────────────────────────────────────────

function CommentList({
  comments,
  producerName,
}: {
  comments: Comment[];
  producerName: string;
}) {
  if (comments.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 py-5 text-center text-xs text-[rgb(var(--fg-muted))]">
        No notes yet. Tap the dashed button above to drop your first
        timestamped comment.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {comments.map((c) => (
        <li
          key={c.id}
          className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5"
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className={
                c.fromProducer
                  ? "rounded-[6px] bg-[rgb(var(--brand-copper)/0.15)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[rgb(var(--brand-copper))]"
                  : "rounded-[6px] bg-[rgb(var(--brand-primary)/0.15)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[rgb(var(--brand-primary))]"
              }
            >
              @ {formatTime(c.timeMs)}
            </span>
            <span className="text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
              {c.fromProducer ? c.authorName || producerName : "You"}
            </span>
            <span className="ml-auto font-mono text-[11px] text-[rgb(var(--fg-muted))]">
              {formatRelativeDate(c.createdAt)}
            </span>
            {c.resolvedAt ? (
              <span className="pill pill-success">Resolved</span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-[rgb(var(--fg-default))]">
            {c.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

// ─── Composer (mobile sheet variant + desktop inline variant) ───────

function CommentComposer({
  version,
  timeMs,
  producerName,
  wavesurferRef,
  onSubmit,
  onDismiss,
  variant,
}: {
  version: Version;
  timeMs: number;
  producerName: string;
  wavesurferRef: React.RefObject<WaveformPlayerHandle | null>;
  onSubmit: (c: Comment) => void;
  onDismiss: () => void;
  variant: "sheet" | "inline";
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const wasPlayingRef = useRef(false);

  const handleFocus = () => {
    const ws = wavesurferRef.current;
    if (ws?.isPlaying()) {
      wasPlayingRef.current = true;
      ws.pause();
    }
  };

  const handleSave = () => {
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError("Write something first.");
      return;
    }
    startTransition(async () => {
      const result = await submitTimestampedComment({
        trackVersionId: version.id,
        timeMs,
        body: trimmed,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSubmit(toCommentShape(result.comment));
      setBody("");
      onDismiss();
      if (wasPlayingRef.current) {
        wavesurferRef.current?.play();
        wasPlayingRef.current = false;
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-[6px] bg-[rgb(var(--brand-primary)/0.15)] px-2 py-1 font-mono text-[11px] font-bold text-[rgb(var(--brand-primary))]">
          @ {formatTime(timeMs)}
        </span>
        <span className="text-[12.5px] text-[rgb(var(--fg-muted))]">
          Leaving feedback for {producerName}
        </span>
      </div>

      <textarea
        value={body}
        autoFocus={variant === "sheet"}
        onChange={(e) => {
          setBody(e.currentTarget.value);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        rows={variant === "sheet" ? 4 : 3}
        maxLength={2000}
        placeholder="What sounds off — or great — at this moment?"
        className="w-full resize-none rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 text-[14px] leading-snug text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
      />

      {error ? (
        <p className="text-xs text-[rgb(var(--fg-danger))]" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="sk-press flex-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 py-3 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="sk-press flex flex-[2] items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-3 text-[13px] font-bold text-[rgb(var(--bg-sidebar))] disabled:opacity-50"
        >
          {pending ? (
            "Sending…"
          ) : (
            <>
              <SendIcon size={14} />
              <span>Send</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Sessions rail (kept as a quiet bottom section) ──────────────────

function SessionsRail({ sessions }: { sessions: Session[] }) {
  return (
    <section className="space-y-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        Sessions
      </p>
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => {
          const date = new Date(s.startsAt);
          const isPast = date < new Date();
          const statusLabel = isPast
            ? "Completed"
            : s.status === "pending"
              ? "Pending approval"
              : "Upcoming";
          return (
            <li
              key={s.id}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
            >
              <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                {date.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                <span className="font-mono">
                  {date.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                {String(s.durationMin)} min
                {s.packageName ? ` · ${s.packageName}` : ""}
                {" · "}
                {statusLabel}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────

function EmptyTracksCard({ producerName }: { producerName: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-12 text-center">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        No tracks yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[rgb(var(--fg-muted))]">
        {producerName} will upload mixes here once work begins. You&rsquo;ll
        be able to listen, leave timestamped notes, and download the
        final version once it&rsquo;s paid.
      </p>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────

function PlusIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DownloadIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12M6 11l6 6 6-6M3 21h18" />
    </svg>
  );
}

function LockIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

function SendIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return formatTime(ms);
}

function formatRelativeDate(d: Date): string {
  const diffDays = Math.floor(
    (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays < 0) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${String(diffDays)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toCommentShape(c: AddedComment): Comment {
  return {
    id: c.id,
    versionId: c.versionId,
    timeMs: c.timeMs,
    body: c.body,
    fromProducer: c.fromProducer,
    authorName: c.authorName,
    createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
    resolvedAt:
      c.resolvedAt == null
        ? null
        : c.resolvedAt instanceof Date
          ? c.resolvedAt
          : new Date(c.resolvedAt),
  };
}
