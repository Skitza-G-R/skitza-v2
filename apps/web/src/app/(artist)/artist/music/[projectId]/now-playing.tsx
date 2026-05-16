"use client";

import { useRef, useState, useTransition } from "react";
import { useArtistAudio } from "~/components/artist/artist-audio-context";
import {
  WaveformPlayer,
  type WaveformPlayerHandle,
} from "~/components/audio/waveform-player";
import { submitTimestampedComment, type AddedComment } from "./actions";

// ─── Types ────────────────────────────────────────────────────────────
// Mirrors `artist.music.project` return shape. Kept local so we don't
// re-import the router's inferred types in a Client Component (the
// router is server-only).

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

// ─── Component ────────────────────────────────────────────────────────
export function NowPlaying({ data }: { data: NowPlayingData }) {
  const audio = useArtistAudio();

  // Per-track selected version — defaults to the latest (first in the
  // desc-sorted `versions` array). When the artist switches versions,
  // the track list keeps the new choice sticky.
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

  // Optimistic comment appends keyed by versionId. We merge with the
  // server-sent comments whenever we render, so a successful submit
  // shows up instantly (before the mutation resolves) and survives the
  // resolve unchanged because the server returns the same shape.
  const [optimisticByVersion, setOptimisticByVersion] = useState<
    Record<string, Comment[]>
  >({});

  return (
    <div className="space-y-6">
      <header>
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {data.project.producerName}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {data.project.title}
        </h1>
      </header>

      {data.tracks.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]">
          No tracks in this project yet. Your producer will upload
          mixes here once work begins.
        </div>
      ) : (
        <ul className="space-y-4">
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
              <li
                key={track.id}
                className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
              >
                <TrackHeader
                  title={track.title}
                  artist={track.artist}
                  producerName={data.project.producerName}
                  versions={track.versions}
                  selectedVersion={selectedVersion ?? null}
                  onSelectVersion={(id) => {
                    setSelectedVersionByTrack((prev) => ({
                      ...prev,
                      [track.id]: id,
                    }));
                  }}
                />

                {selectedVersion ? (
                  <VersionBody
                    track={track}
                    version={selectedVersion}
                    producerName={data.project.producerName}
                    finalPaid={data.project.finalPaid}
                    comments={combined}
                    onOptimisticAppend={(c) => {
                      setOptimisticByVersion((prev) => ({
                        ...prev,
                        [selectedVersion.id]: [
                          ...(prev[selectedVersion.id] ?? []),
                          c,
                        ],
                      }));
                    }}
                  />
                ) : (
                  <p className="mt-2 text-xs text-[rgb(var(--fg-muted))]">
                    No versions uploaded yet.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data.sessions.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] mb-3">
            Sessions
          </h2>
          <ul className="space-y-2">
            {data.sessions.map((session) => {
              const date = new Date(session.startsAt);
              const isPast = date < new Date();
              const statusLabel = isPast
                ? "Completed"
                : session.status === "pending_approval"
                  ? "Pending approval"
                  : session.status === "pending_payment"
                    ? "Awaiting payment"
                    : "Upcoming";
              return (
                <li
                  key={session.id}
                  className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-3"
                >
                  <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                    {date.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                    {" · "}
                    {date.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                    {session.durationMin} min
                    {session.packageName ? ` · ${session.packageName}` : ""}
                    {" · "}
                    {statusLabel}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Mobile-only FAB — stacks above the persistent mini-player
          (which sits at bottom-16). Only renders once a track is
          actively loaded so we don't pin a comment with no audio
          context. Mirrors the inline desktop "+ Comment" affordance. */}
      {audio.state.currentTrack ? (
        <button
          type="button"
          onClick={() => {
            audio.requestComment();
          }}
          aria-label="Add comment at current time"
          className="fixed bottom-20 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[0_4px_12px_-2px_rgb(var(--brand-primary)/0.45)] transition-transform active:translate-y-px sm:hidden"
        >
          <CommentIcon size={20} />
        </button>
      ) : null}
    </div>
  );
}

function CommentIcon({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

// ─── Track header (title + version switcher) ─────────────────────────
function TrackHeader({
  title,
  artist,
  versions,
  selectedVersion,
  onSelectVersion,
}: {
  title: string;
  artist: string | null;
  producerName: string;
  versions: Version[];
  selectedVersion: Version | null;
  onSelectVersion: (id: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        {artist ? (
          <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
            {artist}
          </p>
        ) : null}
      </div>
      {versions.length > 1 ? (
        <div className="flex gap-1">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onSelectVersion(v.id);
              }}
              className={`rounded-sm border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider transition-colors ${
                v.id === selectedVersion?.id
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]/10 text-[rgb(var(--brand-primary))]"
                  : "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--fg-muted))]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : selectedVersion ? (
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {selectedVersion.label}
        </span>
      ) : null}
    </div>
  );
}

// ─── Version body (waveform stub + play/comment + comment list) ──────
function VersionBody({
  track,
  version,
  producerName,
  finalPaid,
  comments,
  onOptimisticAppend,
}: {
  track: Track;
  version: Version;
  producerName: string;
  finalPaid: boolean;
  comments: Comment[];
  onOptimisticAppend: (c: Comment) => void;
}) {
  const audio = useArtistAudio();
  const isCurrent = audio.state.currentTrack?.id === version.id;
  const pendingComment =
    isCurrent && audio.state.pendingComment ? audio.state.pendingComment : null;
  // Imperative handle to the wavesurfer instance — lets the comment
  // composer pause playback on focus and resume on submit (QA F7).
  const wavesurferRef = useRef<WaveformPlayerHandle | null>(null);

  const handleRequestComment = () => {
    if (!isCurrent && version.audioUrl) {
      // If the artist taps Comment while this track isn't the current
      // track in the mini-player, prime it first so requestComment()
      // captures a meaningful timestamp. playTrack() resets position to
      // 0, so the first comment pins at 0s — a reasonable default.
      audio.playTrack({
        id: version.id,
        url: version.audioUrl,
        title: `${version.label} of ${track.title}`,
        producerName,
        artworkUrl: null,
      });
    }
    audio.requestComment();
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {formatDuration(version.durationMs)}
        </span>
        <div className="flex items-center gap-2">
          {version.audioUrl && finalPaid ? (
            <a
              href={version.audioUrl}
              download
              className="inline-flex h-7 items-center rounded px-2 text-xs text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
              aria-label={`Download ${version.label}`}
            >
              Download
            </a>
          ) : version.audioUrl && !finalPaid ? (
            <span className="text-xs text-[rgb(var(--fg-muted))] opacity-50">
              Download unlocks after payment
            </span>
          ) : null}
          {/* Inline + Comment is desktop-only. On mobile (<sm) the FAB at
              the bottom-right of the page replaces it, so the waveform
              gets the full row width to itself. */}
          <button
            type="button"
            onClick={handleRequestComment}
            disabled={!version.audioUrl}
            className="hidden rounded-sm border border-[rgb(var(--border-subtle))] px-2 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--fg-muted))] disabled:opacity-40 sm:inline-flex"
          >
            + Comment
          </button>
        </div>
      </div>

      {version.audioUrl ? (
        <WaveformPlayer
          ref={wavesurferRef}
          src={version.audioUrl}
          height={120}
          label={`${version.label} of ${track.title}`}
          onSeek={(sec) => {
            audio.setPosition(sec);
          }}
        />
      ) : (
        <div
          className="flex h-16 items-center justify-center rounded-sm bg-[rgb(var(--bg-sunken))] text-xs text-[rgb(var(--fg-muted))]"
          aria-label="No audio uploaded for this version"
        >
          No audio yet
        </div>
      )}

      {pendingComment ? (
        <CommentComposer
          version={version}
          timeMs={Math.round(pendingComment.time * 1000)}
          onSubmit={onOptimisticAppend}
          onDismiss={audio.dismissComment}
          wavesurferRef={wavesurferRef}
        />
      ) : null}

      <CommentList comments={comments} />
    </div>
  );
}

// ─── Comment composer (inline form) ──────────────────────────────────
function CommentComposer({
  version,
  timeMs,
  onSubmit,
  onDismiss,
  wavesurferRef,
}: {
  version: Version;
  timeMs: number;
  onSubmit: (c: Comment) => void;
  onDismiss: () => void;
  wavesurferRef: React.RefObject<WaveformPlayerHandle | null>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Tracks whether the waveform was playing at the moment we paused it
  // on focus, so a submit only resumes audio that was actually playing
  // (avoids jarring 0s playback if the artist hadn't started the
  // waveform yet).
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
    // Enter submits, Shift+Enter inserts a newline (chat-composer
    // convention). Required by F7 AC: "Pressing Enter to submit the
    // comment resumes playback."
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="space-y-2 rounded-sm border border-[rgb(var(--brand-primary))]/40 bg-[rgb(var(--bg-sunken))] p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
          Comment at {formatTime(timeMs)}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
        >
          Cancel
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.currentTarget.value);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        rows={3}
        maxLength={2000}
        placeholder="What did you hear?"
        className="w-full resize-none rounded-sm border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2 text-sm text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
      />
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 py-1 text-xs font-medium text-[rgb(var(--bg-base))] disabled:opacity-50"
        >
          {pending ? "Sending…" : "Post"}
        </button>
      </div>
    </div>
  );
}

// ─── Comment list ────────────────────────────────────────────────────
function CommentList({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) {
    return (
      <p className="text-xs text-[rgb(var(--fg-muted))]">
        No comments yet. Tap + Comment while playing to pin your first.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {comments.map((c) => (
        <li
          key={c.id}
          className="rounded-sm border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              {c.fromProducer ? c.authorName : "You"} · {formatTime(c.timeMs)}
            </span>
            {c.resolvedAt ? (
              <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                Resolved
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[rgb(var(--fg-primary))]">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  return formatTime(ms);
}

// The server action returns createdAt as a serialized Date via
// superjson (dates pass through fine); cast here so the optimistic
// append renders the same shape as server-fetched rows.
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
