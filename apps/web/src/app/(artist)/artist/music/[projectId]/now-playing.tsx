"use client";

import { useState, useTransition } from "react";
import { useArtistAudio } from "~/components/artist/artist-audio-context";
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

type NowPlayingData = {
  project: {
    id: string;
    title: string;
    producerId: string;
    producerName: string;
  };
  tracks: Track[];
};

// ─── Component ────────────────────────────────────────────────────────
export function NowPlaying({ data }: { data: NowPlayingData }) {
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
    </div>
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
  comments,
  onOptimisticAppend,
}: {
  track: Track;
  version: Version;
  producerName: string;
  comments: Comment[];
  onOptimisticAppend: (c: Comment) => void;
}) {
  const audio = useArtistAudio();
  const isCurrent = audio.state.currentTrack?.id === version.id;
  const pendingComment =
    isCurrent && audio.state.pendingComment ? audio.state.pendingComment : null;

  const handlePlay = () => {
    if (!version.audioUrl) return;
    audio.playTrack({
      id: version.id,
      url: version.audioUrl,
      title: `${version.label} of ${track.title}`,
      producerName,
      artworkUrl: null,
    });
  };

  const handleRequestComment = () => {
    if (!isCurrent) {
      // If the artist clicks Comment while the track isn't playing in
      // the mini-player, start it first so requestComment() captures a
      // meaningful timestamp. playTrack() also resets position to 0 so
      // the first comment pins at 0s, which is a reasonable default.
      handlePlay();
    }
    audio.requestComment();
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePlay}
          disabled={!version.audioUrl}
          aria-label={`Play ${version.label}`}
          className="rounded-full bg-[rgb(var(--brand-primary))] px-3 py-1 text-xs font-medium text-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Play
        </button>
        <button
          type="button"
          onClick={handleRequestComment}
          disabled={!version.audioUrl}
          className="rounded-sm border border-[rgb(var(--border-subtle))] px-2 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--fg-muted))] disabled:opacity-40"
        >
          + Comment
        </button>
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {formatDuration(version.durationMs)}
        </span>
      </div>

      {/* Waveform stub — flat colored bar. Replace with wavesurfer.js
          once the library ships (tracked as a follow-up). Keeps the
          screen shaped correctly today so the comment-composer UI has
          room to breathe. */}
      <div
        className="h-16 rounded-sm bg-[rgb(var(--bg-sunken))]"
        aria-label="waveform placeholder"
      />

      {pendingComment ? (
        <CommentComposer
          version={version}
          timeMs={Math.round(pendingComment.time * 1000)}
          onSubmit={onOptimisticAppend}
          onDismiss={audio.dismissComment}
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
}: {
  version: Version;
  timeMs: number;
  onSubmit: (c: Comment) => void;
  onDismiss: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    });
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
          className="rounded-full bg-[rgb(var(--brand-primary))] px-3 py-1 text-xs font-medium text-[rgb(var(--bg-base))] disabled:opacity-50"
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
