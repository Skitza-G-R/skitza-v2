"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

import { Waveform50, type WaveformComment } from "~/components/audio/waveform-50";
import {
  playerPlay,
  playerToggle,
  useNowPlaying,
  type PlayerTrack,
} from "~/components/audio/persistent-player";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";

import {
  l3AddComment,
  l3ApproveVersion,
  l3ResolveComment,
} from "./actions";

// ─── Wire types (Date crosses RSC → client as ISO strings) ───────────
export type SongPageVersion = {
  id: string;
  label: string;
  audioUrl: string | null;
  durationMs: number | null;
  uploadedAtIso: string;
  approvedAtIso: string | null;
};

export type SongPageComment = {
  id: string;
  versionId: string;
  timeMs: number;
  body: string;
  fromProducer: boolean;
  authorName: string;
  createdAtIso: string;
  resolvedAtIso: string | null;
};

export type SongPageData = {
  track: {
    id: string;
    title: string;
    artist: string | null;
    projectId: string;
    projectTitle: string;
    clientName: string | null;
  };
  versions: SongPageVersion[];
  comments: SongPageComment[];
  selectedVersionId: string;
};

// ─── Pure helpers (exported for direct unit-testing) ─────────────────

// Builds the PlayerTrack payload that PersistentPlayer expects when we
// dispatch `skitza:player:set` to start playback of the active version.
//
// The subtitle convention follows the rest of the dashboard
// (recent-uploads-shelf.tsx → cardPlayDetail): "Client · vN" reads
// better than "vN · Client" when the floating player ticker truncates.
// Falls back through clientName → artist → projectTitle so we never
// render "null · v3" for legacy rows that never carried a client name.
export function activeVersionToPlayerTrack(
  track: SongPageData["track"],
  version: SongPageVersion,
): PlayerTrack {
  const label = track.clientName ?? track.artist ?? track.projectTitle;
  return {
    id: version.id,
    audioUrl: version.audioUrl,
    title: track.title,
    subtitle: `${label} · ${version.label}`,
    durationMs: version.durationMs,
  };
}

// Derives the play button's UI + behaviour from the current player
// state. Three branches matter:
//
//   1. audioUrl is null         → disabled (nothing to play yet,
//                                  upload still pending)
//   2. THIS version is loaded   → toggle pause/resume on the existing
//      in PersistentPlayer         <audio> element rather than reload it
//                                  (label flips Pause/Play with state)
//   3. nothing or another track → start fresh via `playerPlay`
//
// Returning a tagged action lets the click handler stay dumb:
//   `state.action === "toggle" ? playerToggle() : playerPlay(track)`
export type PlayButtonState = {
  label: "Play" | "Pause";
  disabled: boolean;
  action: "play-new" | "toggle";
};

export function playButtonState(input: {
  activeVersionId: string;
  audioUrl: string | null;
  nowPlaying: { trackId: string | null; playing: boolean };
}): PlayButtonState {
  const isThisVersionLoaded = input.nowPlaying.trackId === input.activeVersionId;
  if (isThisVersionLoaded) {
    return {
      label: input.nowPlaying.playing ? "Pause" : "Play",
      disabled: input.audioUrl === null,
      action: "toggle",
    };
  }
  return {
    label: "Play",
    disabled: input.audioUrl === null,
    action: "play-new",
  };
}

export function SongPage({ data }: { data: SongPageData }) {
  // Active version — the one the L1 row pointed at by default. Switching
  // a version filters the comment thread to that version's notes.
  const [activeVersionId, setActiveVersionId] = useState(data.selectedVersionId);
  const activeVersion = useMemo(
    () =>
      data.versions.find((v) => v.id === activeVersionId) ??
      data.versions[0] ??
      null,
    [data.versions, activeVersionId],
  );

  // Optimistic comments + resolutions, keyed by versionId. Server
  // mutations re-render the parent (revalidatePath) so these only
  // exist during the round-trip.
  const [optimisticByVersion, setOptimisticByVersion] = useState<
    Record<string, SongPageComment[]>
  >({});
  const [resolvedOverrides, setResolvedOverrides] = useState<
    Record<string, boolean>
  >({});
  const [showResolved, setShowResolved] = useState(false);

  // Live current-time from the waveform — used to anchor the "add note
  // at 0:34" composer chip. Updated by Waveform50's onProgress callback.
  const [currentMs, setCurrentMs] = useState(0);

  // Subscribed read of "what's currently playing" — flips the action-rail
  // play button to "Pause" when the active version is the one playing,
  // and lets the click handler decide between starting fresh vs toggling
  // the existing <audio> element in PersistentPlayer.
  const nowPlaying = useNowPlaying();

  // Local-only "favorite" toggle — the backend mutation isn't wired
  // yet, but the UI affordance ships now so the action rail matches
  // the design. State resets per page navigation, which is fine for
  // the optimistic preview; persistence lands when producer-favorites
  // is added on the server.
  const [isFavorite, setIsFavorite] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);

  // Comments visible right now: server + optimistic for the active
  // version, filtered by resolved-state unless toggled. Sorted by
  // timeMs asc so the thread reads in track order.
  const visibleComments = useMemo(() => {
    if (!activeVersionId) return [];
    const server = data.comments.filter((c) => c.versionId === activeVersionId);
    const optimistic = optimisticByVersion[activeVersionId] ?? [];
    const merged = [...server, ...optimistic].sort((a, b) => a.timeMs - b.timeMs);
    return merged.filter((c) => {
      const isResolvedOverride = resolvedOverrides[c.id];
      const isResolved =
        isResolvedOverride !== undefined
          ? isResolvedOverride
          : c.resolvedAtIso !== null;
      return showResolved ? true : !isResolved;
    });
  }, [activeVersionId, data.comments, optimisticByVersion, resolvedOverrides, showResolved]);

  const allCommentsForVersion = useMemo(() => {
    if (!activeVersionId) return [];
    const server = data.comments.filter((c) => c.versionId === activeVersionId);
    const optimistic = optimisticByVersion[activeVersionId] ?? [];
    return [...server, ...optimistic];
  }, [activeVersionId, data.comments, optimisticByVersion]);

  const hasResolvedComments = allCommentsForVersion.some((c) => {
    const override = resolvedOverrides[c.id];
    return override !== undefined ? override : c.resolvedAtIso !== null;
  });

  // Markers fed to the waveform — comments for the active version only.
  // We don't render markers for resolved comments unless `showResolved`
  // is on (matches the comment thread).
  const waveformComments: WaveformComment[] = useMemo(() => {
    if (!activeVersion?.durationMs) return [];
    return allCommentsForVersion
      .filter((c) => {
        const override = resolvedOverrides[c.id];
        const isResolved = override !== undefined ? override : c.resolvedAtIso !== null;
        return showResolved ? true : !isResolved;
      })
      .map((c) => ({
        id: c.id,
        timeMs: c.timeMs,
        fromProducer: c.fromProducer,
      }));
  }, [activeVersion?.durationMs, allCommentsForVersion, resolvedOverrides, showResolved]);

  const clientLabel = data.track.clientName ?? data.track.artist ?? data.track.projectTitle;
  const heroBg = producerGradient(clientLabel);

  function handleAddComment() {
    if (!activeVersion) return;
    const body = draftRef.current?.value.trim();
    if (!body) return;
    setError(null);
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    const optimistic: SongPageComment = {
      id: tempId,
      versionId: activeVersion.id,
      timeMs: currentMs,
      body,
      fromProducer: true,
      authorName: "You",
      createdAtIso: new Date().toISOString(),
      resolvedAtIso: null,
    };
    setOptimisticByVersion((prev) => ({
      ...prev,
      [activeVersion.id]: [...(prev[activeVersion.id] ?? []), optimistic],
    }));
    if (draftRef.current) draftRef.current.value = "";

    startTransition(async () => {
      const res = await l3AddComment({
        versionId: activeVersion.id,
        body,
        timestampMs: currentMs,
      });
      if (!res.ok) {
        // Roll back optimistic on failure.
        setOptimisticByVersion((prev) => ({
          ...prev,
          [activeVersion.id]: (prev[activeVersion.id] ?? []).filter(
            (c) => c.id !== tempId,
          ),
        }));
        setError(res.error);
      }
    });
  }

  function handleResolveToggle(comment: SongPageComment) {
    const override = resolvedOverrides[comment.id];
    const currentResolved =
      override !== undefined ? override : comment.resolvedAtIso !== null;
    const next = !currentResolved;
    setResolvedOverrides((p) => ({ ...p, [comment.id]: next }));
    if (!activeVersion) return;
    startTransition(async () => {
      const res = await l3ResolveComment({
        versionId: activeVersion.id,
        id: comment.id,
        resolved: next,
      });
      if (!res.ok) {
        setResolvedOverrides((p) => ({ ...p, [comment.id]: currentResolved }));
        setError(res.error);
      }
    });
  }

  function handleApproveToggle() {
    if (!activeVersion) return;
    const isApproved = activeVersion.approvedAtIso !== null;
    startTransition(async () => {
      const res = await l3ApproveVersion({
        versionId: activeVersion.id,
        approved: !isApproved,
      });
      if (!res.ok) setError(res.error);
    });
  }

  // Play / Pause click — branches on the helper-derived action so the
  // toggle path doesn't reload the <audio> element when the producer is
  // already listening to this version.
  function handlePlayToggle() {
    if (!activeVersion) return;
    const state = playButtonState({
      activeVersionId: activeVersion.id,
      audioUrl: activeVersion.audioUrl,
      nowPlaying,
    });
    if (state.disabled) return;
    if (state.action === "toggle") {
      playerToggle();
      return;
    }
    playerPlay(activeVersionToPlayerTrack(data.track, activeVersion));
  }

  if (!activeVersion) {
    return (
      <main className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6">
        <Link
          href="/dashboard/music"
          className="text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          ← Back to Library
        </Link>
        <p className="mt-6 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          This track has no versions yet.
        </p>
      </main>
    );
  }

  const isApproved = activeVersion.approvedAtIso !== null;

  return (
    <main className="sk-page-enter">
      {/* Hero band — gradient backdrop derived from client name (same
          deterministic palette the rest of the producer dashboard uses
          for project covers). White text floats above. */}
      <header
        className="relative isolate overflow-hidden text-white"
        style={{ background: heroBg }}
      >
        <div className="mx-auto max-w-[1100px] px-4 pt-6 pb-7 sm:px-6 sm:pt-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/dashboard/music"
              className="sk-press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/25 bg-white/10 px-3 py-1.5 text-[11.5px] font-semibold backdrop-blur-sm"
            >
              <ChevronLeftIcon /> Back to Library
            </Link>
            <Link
              href={`/dashboard/clients-projects/${data.track.projectId}?tab=music&version=${activeVersion.id}`}
              className="sk-press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-white/25 bg-white/10 px-3 py-1.5 text-[11.5px] font-semibold backdrop-blur-sm"
            >
              Open in project room <ChevronRightIcon />
            </Link>
          </div>

          <div className="flex flex-wrap items-end gap-5">
            {/* Album-art tile — gradient + waveform glyph. Click toggles
                the persistent player (deferred — not wired in this slice
                because v3-clean's player API is a side-tab dock, not a
                hero overlay). */}
            <div
              aria-hidden
              className="relative flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-black/20 shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
            >
              <WaveformGlyph />
            </div>
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] opacity-80">
                Song · {data.track.projectTitle}
              </span>
              <h1 className="font-display mt-1 text-[clamp(28px,4vw,44px)] font-extrabold leading-none tracking-[-0.03em] [text-shadow:0_2px_14px_rgba(0,0,0,0.18)]">
                {data.track.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] opacity-90">
                {clientLabel ? <span>{clientLabel}</span> : null}
                {activeVersion.durationMs ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono tabular-nums">
                      {fmtMs(activeVersion.durationMs)}
                    </span>
                  </>
                ) : null}
                <span aria-hidden>·</span>
                <span>uploaded {fmtRelativeIso(activeVersion.uploadedAtIso)}</span>
                {isApproved ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[rgb(17_16_9)]">
                      <CheckIcon /> Approved
                    </span>
                  </>
                ) : null}
              </div>

              {/* Version switcher — pill cluster, current version flagged */}
              {data.versions.length > 1 ? (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] opacity-75">
                    Version
                  </span>
                  {data.versions.map((v) => {
                    const isActive = v.id === activeVersion.id;
                    const isLatest = v.id === data.versions[0]?.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setActiveVersionId(v.id);
                        }}
                        className={[
                          "sk-press rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold transition",
                          isActive
                            ? "border-white bg-white text-[rgb(17_16_9)]"
                            : "border-white/25 bg-white/10 text-white",
                        ].join(" ")}
                      >
                        {v.label}
                        {isActive && isLatest ? " · current" : ""}
                        {v.approvedAtIso ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Action rail — Play/Pause + approve. The Play button is the
                primary CTA: clicking it pushes this version into the
                PersistentPlayer (mounted at AppShell), which exposes the
                fixed-bottom dock and survives client-side navigation so
                the producer can keep listening while clicking around. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {(() => {
                const playState = playButtonState({
                  activeVersionId: activeVersion.id,
                  audioUrl: activeVersion.audioUrl,
                  nowPlaying,
                });
                const isPlayingThis =
                  playState.action === "toggle" && playState.label === "Pause";
                return (
                  <button
                    type="button"
                    onClick={handlePlayToggle}
                    disabled={playState.disabled}
                    aria-label={playState.label}
                    title={
                      playState.disabled
                        ? "Audio is still uploading"
                        : playState.label
                    }
                    className={[
                      "sk-press inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-bold transition",
                      "bg-white text-[rgb(17_16_9)] shadow-[0_4px_14px_rgba(0,0,0,0.18)]",
                      "disabled:cursor-not-allowed disabled:opacity-50",
                    ].join(" ")}
                  >
                    {isPlayingThis ? <PauseIcon /> : <PlayIcon />}
                    {playState.label}
                  </button>
                );
              })()}
              <button
                type="button"
                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={isFavorite}
                title={isFavorite ? "In favorites" : "Add to favorites"}
                onClick={() => {
                  setIsFavorite((f) => !f);
                }}
                className={[
                  "sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                  isFavorite
                    ? "border-white bg-white text-[rgb(var(--brand-primary-dark))]"
                    : "border-white/22 bg-white/14 text-white",
                ].join(" ")}
              >
                <StarIcon filled={isFavorite} />
              </button>
              <button
                type="button"
                aria-label="Share with artist"
                title="Share with artist"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  const url = window.location.href;
                  // DOM lib types `navigator.share` as required, but
                  // browsers without the Web Share API throw on call
                  // — synchronous TypeError, not rejected promise.
                  // try/catch handles both that path AND a missing
                  // navigator.clipboard (insecure contexts) without
                  // tripping the strict-truthy lint rule.
                  try {
                    void navigator.share({ title: data.track.title, url }).catch(() => {
                      // User dismissed the native sheet — no-op.
                    });
                  } catch {
                    try {
                      void navigator.clipboard.writeText(url).catch(() => {
                        // Permission denied or no focus — silent.
                      });
                    } catch {
                      // Neither API available; the affordance is non-
                      // destructive, so silent fall-through is fine.
                    }
                  }
                }}
                className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white"
              >
                <ShareIcon />
              </button>
              {activeVersion.audioUrl ? (
                <a
                  aria-label="Download"
                  title="Download"
                  href={activeVersion.audioUrl}
                  download
                  className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white"
                >
                  <DownloadIcon />
                </a>
              ) : (
                <button
                  type="button"
                  aria-label="Download"
                  title="Download (no audio uploaded yet)"
                  disabled
                  className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/22 bg-white/14 text-white opacity-50"
                >
                  <DownloadIcon />
                </button>
              )}
              <button
                type="button"
                onClick={handleApproveToggle}
                disabled={isPending}
                className={[
                  "sk-press inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-bold transition",
                  isApproved
                    ? "bg-white text-[rgb(17_16_9)]"
                    : "bg-[rgb(var(--brand-primary))] text-[rgb(17_16_9)]",
                  "disabled:opacity-60",
                ].join(" ")}
              >
                <CheckIcon /> {isApproved ? "Approved" : "Approve version"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Body — waveform + comments */}
      <section className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
        {/* Waveform card */}
        <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
          <Waveform50
            durationMs={activeVersion.durationMs ?? 240_000}
            comments={waveformComments}
            seed={activeVersion.id}
            onProgress={setCurrentMs}
          />
          <p className="mt-3 text-center font-mono text-[10px] tracking-wider text-[rgb(var(--fg-muted))]">
            Click the waveform to seek · Click a marker to jump to a note
          </p>
        </div>

        {/* Comments thread */}
        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-[15px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
              Notes at timestamp
              <span className="ml-2 font-mono text-[11px] font-normal text-[rgb(var(--fg-muted))] tabular-nums">
                {String(visibleComments.length)}
                {visibleComments.length !== allCommentsForVersion.length
                  ? ` of ${String(allCommentsForVersion.length)}`
                  : ""}
              </span>
            </h2>
            {hasResolvedComments ? (
              <button
                type="button"
                onClick={() => {
                  setShowResolved((s) => !s);
                }}
                className="font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </button>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-[12px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          {visibleComments.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
              No notes yet on this version. Type below to drop one at the
              current playhead.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {visibleComments.map((c) => {
                const override = resolvedOverrides[c.id];
                const isResolved =
                  override !== undefined ? override : c.resolvedAtIso !== null;
                return (
                  <li
                    key={c.id}
                    className={[
                      "flex items-start gap-3 rounded-[var(--radius-md)] px-3 py-2.5",
                      c.fromProducer
                        ? "bg-[rgb(var(--brand-primary)/0.06)]"
                        : "",
                      isResolved ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <span
                      aria-hidden
                      className={[
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-wider text-white",
                        c.fromProducer
                          ? "bg-[rgb(var(--brand-primary))]"
                          : "bg-[rgb(var(--fg-muted))]",
                      ].join(" ")}
                    >
                      {initials(c.authorName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                          {c.authorName}
                        </span>
                        <span className="rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-1.5 py-px font-mono text-[9.5px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums">
                          @{fmtMs(c.timeMs)}
                        </span>
                        <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                          {fmtRelativeIso(c.createdAtIso)}
                        </span>
                        {isResolved ? (
                          <span className="rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[rgb(var(--brand-primary-dark))]">
                            ✓ Resolved
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={[
                          "mt-1 text-[13px] leading-snug text-[rgb(var(--fg-default))]",
                          isResolved ? "line-through" : "",
                        ].join(" ")}
                      >
                        {c.body}
                      </p>
                      <div className="mt-1.5 flex gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            handleResolveToggle(c);
                          }}
                          className="text-[10.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                        >
                          {isResolved ? "Reopen" : "Resolve"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Composer — anchors to the current playhead */}
          <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
            <span className="shrink-0 rounded-full bg-[rgb(var(--brand-primary)/0.18)] px-1.5 py-px font-mono text-[9.5px] font-bold text-[rgb(var(--brand-primary-dark))] tabular-nums">
              @{fmtMs(currentMs)}
            </span>
            <input
              ref={draftRef}
              type="text"
              maxLength={2000}
              placeholder="Add a note at this timestamp…"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-[rgb(var(--fg-muted))]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddComment();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddComment}
              disabled={isPending}
              className="sk-press rounded-[var(--radius-sm)] bg-[rgb(var(--fg-default))] px-3 py-1.5 text-[11.5px] font-bold text-[rgb(var(--bg-elevated))] disabled:opacity-60"
            >
              Post
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

// ─── Local primitives ────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

function fmtRelativeIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${String(Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${String(Math.floor(diff / hour))}h ago`;
  if (diff < 7 * day) return `${String(Math.floor(diff / day))}d ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "·";
}

function ChevronLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="10 4 6 8 10 12" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 4 10 8 6 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 8.5 7 12 13 5" />
    </svg>
  );
}

function WaveformGlyph() {
  return (
    <svg width="48" height="48" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="11" x2="6" y2="21" />
      <line x1="11" y1="7" x2="11" y2="25" />
      <line x1="16" y1="4" x2="16" y2="28" />
      <line x1="21" y1="9" x2="21" y2="23" />
      <line x1="26" y1="13" x2="26" y2="19" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2" height="7" rx="0.5" />
      <rect x="7" y="2.5" width="2" height="7" rx="0.5" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  // 5-point star — `d="M8 1.5..."` keeps the test grep stable across
  // future tweaks to stroke / fill. Filled toggles between solid (in-
  // favorites) and outline (not yet favorited).
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.5 9.94 5.85 14.5 6.4 11.05 9.55 12 14.5 8 11.95 4 14.5 4.95 9.55 1.5 6.4 6.06 5.85 Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="3.5" r="2" />
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="12.5" r="2" />
      <line x1="5.7" y1="7" x2="10.3" y2="4.5" />
      <line x1="5.7" y1="9" x2="10.3" y2="11.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v8" />
      <polyline points="4.5 7 8 10.5 11.5 7" />
      <line x1="2.5" y1="13.5" x2="13.5" y2="13.5" />
    </svg>
  );
}
