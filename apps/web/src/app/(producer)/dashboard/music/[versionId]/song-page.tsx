"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Waveform50, type WaveformComment } from "~/components/audio/waveform-50";
import {
  PLAYER_EVENTS,
  playerPlay,
  playerSeek,
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
  // Default to TRUE — founder feedback: "resolve now disappears
  // messages, I want it greyed out and sent to the bottom." Showing
  // resolved by default + sorting them last preserves the
  // conversation history. The toggle below switches to a "hide
  // resolved" mode for producers who want a cleaner view.
  const [showResolved, setShowResolved] = useState<boolean>(true);

  // Live current-time from the waveform — used to anchor the "add note
  // at 0:34" composer chip. Updated by Waveform50's onProgress callback.
  const [currentMs, setCurrentMs] = useState(0);

  // Subscribed read of "what's currently playing" — flips the action-rail
  // play button to "Pause" when the active version is the one playing,
  // and lets the click handler decide between starting fresh vs toggling
  // the existing <audio> element in PersistentPlayer.
  const nowPlaying = useNowPlaying();

  // Tracks whether playback was ours-paused for typing. Used by the
  // composer's onFocus + handleAddComment so submitting (or
  // dismissing) the composer auto-resumes only when WE paused, not
  // when the producer had already paused themselves.
  const wasPlayingBeforeFocus = useRef(false);

  // Sync the composer's `@mm:ss` chip with live audio time. Without
  // this, currentMs only updates on user click/drag/keyboard
  // (Waveform50's onProgress fires only on user interaction). The
  // founder reported the timestamp falling behind the dock; this
  // listener mirrors PersistentPlayer's broadcast so the chip stays
  // exact while audio plays.
  useEffect(() => {
    function onTime(e: Event) {
      const ms = (e as CustomEvent<number>).detail;
      if (Number.isFinite(ms) && ms >= 0) setCurrentMs(ms);
    }
    window.addEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    };
  }, []);

  // Local-only "favorite" toggle — the backend mutation isn't wired
  // yet, but the UI affordance ships now so the action rail matches
  // the design. State resets per page navigation, which is fine for
  // the optimistic preview; persistence lands when producer-favorites
  // is added on the server.
  const [isFavorite, setIsFavorite] = useState(false);

  // Secondary actions overflow menu (heart/share/download). Click-out
  // closes it. Premium players keep utility actions out of the primary
  // sightline — the menu collapses into a single circular trigger.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    function onDown(e: MouseEvent) {
      const node = overflowRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement | null>(null);

  // Comments visible right now: server + optimistic for the active
  // version. Resolved comments sink to the BOTTOM (visible but greyed
  // out — see the row's `opacity-60` + line-through styles) so the
  // active conversation stays at the top of the thread. Within each
  // group, comments sort by timeMs asc so they read in track order.
  // The "Hide resolved" toggle drops the resolved rows entirely for
  // producers who want a cleaner view.
  const visibleComments = useMemo(() => {
    if (!activeVersionId) return [];
    const server = data.comments.filter((c) => c.versionId === activeVersionId);
    const optimistic = optimisticByVersion[activeVersionId] ?? [];
    const merged = [...server, ...optimistic];
    const isCommentResolved = (c: SongPageComment): boolean => {
      const override = resolvedOverrides[c.id];
      return override !== undefined ? override : c.resolvedAtIso !== null;
    };
    const filtered = merged.filter((c) => (showResolved ? true : !isCommentResolved(c)));
    return filtered.sort((a, b) => {
      const aRes = isCommentResolved(a);
      const bRes = isCommentResolved(b);
      // Resolved last — primary sort key.
      if (aRes !== bRes) return aRes ? 1 : -1;
      return a.timeMs - b.timeMs;
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

    // If we paused playback when the composer got focus, resume
    // playback now that the producer's done typing. Pre-flip the
    // ref so the input's onBlur can't double-fire.
    const shouldResume = wasPlayingBeforeFocus.current;
    wasPlayingBeforeFocus.current = false;
    if (shouldResume) {
      playerToggle();
    }

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
      } else {
        // Clear optimistic on success too. The server action calls
        // revalidatePath, so the next render carries the canonical
        // row from the DB. Without this filter we'd render BOTH the
        // optimistic copy AND the server copy → comment appears twice
        // (the founder reported this as "post twice").
        setOptimisticByVersion((prev) => ({
          ...prev,
          [activeVersion.id]: (prev[activeVersion.id] ?? []).filter(
            (c) => c.id !== tempId,
          ),
        }));
      }
    });
  }

  // Focus on the composer pauses live playback so the producer can
  // think + type without the music racing ahead. Submitting (handle
  // AddComment) or blurring resumes playback if WE paused it.
  function handleComposerFocus() {
    if (!activeVersion) return;
    const isThisVersionPlaying =
      nowPlaying.trackId === activeVersion.id && nowPlaying.playing;
    if (isThisVersionPlaying) {
      wasPlayingBeforeFocus.current = true;
      playerToggle();
    }
  }

  function handleComposerBlur() {
    // Resume on blur ONLY if the composer didn't submit (handleAdd
    // Comment already resumed in that path). The flag is cleared on
    // submit, so this branch only fires when the user clicked away
    // without posting.
    if (wasPlayingBeforeFocus.current) {
      wasPlayingBeforeFocus.current = false;
      playerToggle();
    }
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

  // Jump to a comment's timestamp. If the active version isn't the one
  // currently playing in the dock, push it into PersistentPlayer FIRST
  // so the seek lands on a loaded <audio> element. Then dispatch the
  // seek and ensure the player is unpaused so the producer immediately
  // hears the moment they clicked.
  function handleJumpToComment(timeMs: number) {
    if (!activeVersion) return;
    if (!activeVersion.audioUrl) return;
    const isThisVersionLoaded = nowPlaying.trackId === activeVersion.id;
    if (!isThisVersionLoaded) {
      playerPlay(activeVersionToPlayerTrack(data.track, activeVersion));
    } else if (!nowPlaying.playing) {
      playerToggle();
    }
    // playerPlay resets currentTime to 0 inside PersistentPlayer; fire
    // the seek on the next macrotask so it doesn't get clobbered by
    // that reset. setTimeout(0) is enough — the player's onSet handler
    // is synchronous.
    setTimeout(() => {
      playerSeek(timeMs);
    }, 0);
    setCurrentMs(timeMs);
  }

  // Reply to a comment — pre-fills the composer with @author and
  // focuses it so the producer can just start typing. The `@author `
  // mention isn't parsed server-side yet, but it's a familiar
  // interaction and survives any future mention-renderer wiring.
  function handleReplyToComment(authorName: string) {
    const input = draftRef.current;
    if (!input) return;
    const prefix = `@${authorName} `;
    if (!input.value.startsWith(prefix)) {
      input.value = prefix;
    }
    input.focus();
    input.scrollIntoView({ block: "center", behavior: "smooth" });
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

  function handleShare() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    // DOM lib types `navigator.share` as required, but browsers without
    // the Web Share API throw on call — synchronous TypeError, not
    // rejected promise. try/catch handles both that path AND a missing
    // navigator.clipboard (insecure contexts) without tripping the
    // strict-truthy lint rule.
    try {
      void navigator.share({ title: data.track.title, url }).catch(() => undefined);
    } catch {
      try {
        void navigator.clipboard.writeText(url).catch(() => undefined);
      } catch {
        // Neither API available; affordance is non-destructive.
      }
    }
    setOverflowOpen(false);
  }

  if (!activeVersion) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-12 sm:px-6">
        <Link
          href="/dashboard/music"
          className="text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          ← Back to Library
        </Link>
        <p className="mt-6 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          This track has no versions yet.
        </p>
      </main>
    );
  }

  const isApproved = activeVersion.approvedAtIso !== null;
  const playState = playButtonState({
    activeVersionId: activeVersion.id,
    audioUrl: activeVersion.audioUrl,
    nowPlaying,
  });
  const isPlayingThis =
    playState.action === "toggle" && playState.label === "Pause";

  return (
    <main className="sk-page-enter relative">
      {/* Page-wide film-grain — Editorial Luxury texture cue. Fixed,
          pointer-events-none, never repaints on scroll. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40 opacity-[0.022] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(rgb(17 16 9) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />

      {/* ───── Hero band ─────────────────────────────────────────────
          Editorial-luxury treatment: gradient backdrop bleeds out via
          a deep radial mask + two-stop linear fade, so the band feels
          like the OPENING of a record sleeve rather than a card glued
          to the top of the page. */}
      <header
        className="relative isolate overflow-hidden text-white"
        style={{ background: heroBg }}
      >
        {/* Atmosphere — soft highlight at top-left + ambient bottom fade
            so the gradient melts into the canvas with no hard edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 12% 8%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(80% 60% at 88% 0%, rgba(255,255,255,0.08), transparent 60%), linear-gradient(180deg, rgba(17,16,9,0) 0%, rgba(17,16,9,0.18) 60%, rgb(var(--bg-background)) 100%)",
          }}
        />
        {/* Subtle film-grain hint — adds physical texture without
            cooking the gradient. Only at very low opacity. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
          style={{
            backgroundImage:
              "radial-gradient(rgb(255 255 255) 1px, transparent 1px)",
            backgroundSize: "3px 3px",
          }}
        />

        <div className="relative mx-auto max-w-[1120px] px-4 pt-7 pb-9 sm:px-6 sm:pt-9 sm:pb-12">
          {/* Top breadcrumb row — quiet glass pills, no visual heft */}
          <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/dashboard/music"
              className="sk-press group inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur-md transition-colors duration-200 hover:bg-white/[0.14]"
            >
              <ChevronLeftIcon />
              <span>Library</span>
            </Link>
            {/* Button-in-Button — trailing chevron lives inside its own
                circular wrapper. On hover, it translates diagonally and
                scales up, creating kinetic tension (Section 5B). */}
            <Link
              href={`/dashboard/clients-projects/${data.track.projectId}?tab=music&version=${activeVersion.id}`}
              className="sk-press group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] py-1 pl-3 pr-1 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur-md transition-colors duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.16]"
            >
              <span>Open in project room</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.14] transition-transform duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-[1.06]">
                <ChevronRightIcon />
              </span>
            </Link>
          </div>

          <div className="flex flex-col gap-7 md:flex-row md:items-end md:gap-8">
            {/* Album-art tile — Double-bezel: glass outer ring + inner
                gradient core with reflection + a centered audio glyph.
                Reads as physical hardware, not a placeholder box. */}
            <div className="reveal-up shrink-0">
              <div
                aria-hidden
                className="relative rounded-[28px] p-[3px]"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.18) 100%)",
                  boxShadow:
                    "0 30px 80px -20px rgba(0,0,0,0.55), 0 2px 0 0 rgba(255,255,255,0.18) inset",
                }}
              >
                <div
                  className="relative flex h-[132px] w-[132px] items-center justify-center overflow-hidden rounded-[25px] text-white"
                  style={{
                    background:
                      "linear-gradient(155deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 60%, rgba(255,255,255,0.06) 100%)",
                    boxShadow:
                      "inset 0 1px 0 0 rgba(255,255,255,0.18), inset 0 -40px 50px -20px rgba(0,0,0,0.4)",
                  }}
                >
                  <WaveformGlyph />
                  {/* Reflection slash — a subtle diagonal highlight. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.10) 45%, transparent 55%)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Title block + meta */}
            <div className="reveal-up reveal-up-delay-1 min-w-0 flex-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                Song · {data.track.projectTitle}
              </span>
              <h1
                className="font-display mt-2 text-[clamp(34px,5vw,56px)] font-extrabold leading-[1] tracking-[-0.035em]"
                style={{ textShadow: "0 2px 22px rgba(0,0,0,0.22)" }}
              >
                {data.track.title}
              </h1>
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/85">
                {clientLabel ? (
                  <span className="font-medium">{clientLabel}</span>
                ) : null}
                {activeVersion.durationMs ? (
                  <>
                    <span aria-hidden className="text-white/40">·</span>
                    <span className="font-mono tabular-nums">
                      {fmtMs(activeVersion.durationMs)}
                    </span>
                  </>
                ) : null}
                <span aria-hidden className="text-white/40">·</span>
                <span className="text-white/70">
                  uploaded {fmtRelativeIso(activeVersion.uploadedAtIso)}
                </span>
                {isApproved ? (
                  <>
                    <span aria-hidden className="text-white/40">·</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(17_16_9)]">
                      <CheckIcon /> Approved
                    </span>
                  </>
                ) : null}
              </div>

              {/* Version pills — magnetic hover, monospace labels */}
              {data.versions.length > 1 ? (
                <div className="mt-5 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-white/55">
                    Version
                  </span>
                  {data.versions.map((v, i) => {
                    const isActive = v.id === activeVersion.id;
                    const isLatest = v.id === data.versions[0]?.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setActiveVersionId(v.id);
                        }}
                        style={{ animationDelay: `${String(120 + i * 50)}ms` }}
                        className={[
                          "sk-press reveal-up rounded-full border px-3 py-1 font-mono text-[10.5px] font-bold tracking-wide",
                          "transition-[background-color,border-color,transform] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                          isActive
                            ? "border-white bg-white text-[rgb(17_16_9)] shadow-[0_6px_18px_-6px_rgba(255,255,255,0.45)]"
                            : "border-white/22 bg-white/[0.08] text-white/85 hover:-translate-y-px hover:bg-white/[0.16]",
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

            {/* Action rail — ONE confident Play CTA + a single secondary
                overflow trigger + a quiet Approve. The brand color now
                belongs to the playhead, NOT the chrome — Approve uses
                a glass outline + check icon, flipping to filled white
                once already approved. */}
            <div className="reveal-up reveal-up-delay-2 flex shrink-0 flex-wrap items-center gap-2.5">
              {/* Play CTA — primary, magnetic, glow when playing. The
                  in-context play button inside the waveform card below
                  reuses the same handler so the two stay locked. */}
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
                  "sk-press group relative inline-flex items-center gap-2 rounded-full pl-2 pr-5 py-2 text-[13px] font-bold",
                  "transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  "bg-white text-[rgb(17_16_9)] disabled:cursor-not-allowed disabled:opacity-50",
                  isPlayingThis
                    ? "shadow-[0_10px_30px_-8px_rgba(255,255,255,0.5),0_0_0_1px_rgba(255,255,255,0.4)]"
                    : "shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)] hover:-translate-y-px hover:shadow-[0_14px_36px_-8px_rgba(0,0,0,0.4)]",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full",
                    "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.05]",
                    isPlayingThis
                      ? "bg-[rgb(var(--brand-primary))] text-white"
                      : "bg-[rgb(17_16_9)] text-white",
                  ].join(" ")}
                >
                  {isPlayingThis ? <PauseIcon /> : <PlayIcon />}
                </span>
                <span className="tracking-[-0.005em]">{playState.label}</span>
              </button>

              {/* Approve — quiet glass outline by default; filled cream
                  once approved. Brand amber is reserved for the playhead. */}
              <button
                type="button"
                onClick={handleApproveToggle}
                disabled={isPending}
                title={isApproved ? "Approved" : "Approve version"}
                aria-label={isApproved ? "Approved" : "Approve version"}
                className={[
                  "sk-press inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-bold",
                  "transition-[background-color,border-color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isApproved
                    ? "border border-white/0 bg-white/95 text-[rgb(17_16_9)] shadow-[0_6px_20px_-6px_rgba(255,255,255,0.45)]"
                    : "border border-white/28 bg-white/[0.06] text-white hover:bg-white/[0.14] hover:-translate-y-px",
                  "disabled:opacity-60",
                ].join(" ")}
              >
                <CheckIcon /> {isApproved ? "Approved" : "Approve"}
              </button>

              {/* Overflow — single glass circle for share / favorite /
                  download. Origin-aware popover scales from this trigger. */}
              <div ref={overflowRef} className="relative">
                <button
                  type="button"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  onClick={() => {
                    setOverflowOpen((o) => !o);
                  }}
                  className={[
                    "sk-press inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/22",
                    "transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    overflowOpen
                      ? "bg-white/[0.22]"
                      : "bg-white/[0.08] hover:bg-white/[0.16]",
                  ].join(" ")}
                >
                  <MoreIcon />
                </button>
                {overflowOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 origin-top-right overflow-hidden rounded-[18px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 text-[rgb(var(--fg-default))] shadow-[0_30px_60px_-15px_rgba(17,16,9,0.35)]"
                    style={{
                      animation:
                        "skitza-pop-in 220ms cubic-bezier(0.23, 1, 0.32, 1) both",
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={
                        isFavorite ? "Remove from favorites" : "Add to favorites"
                      }
                      aria-pressed={isFavorite}
                      onClick={() => {
                        setIsFavorite((f) => !f);
                        setOverflowOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
                        <StarIcon filled={isFavorite} />
                      </span>
                      {isFavorite ? "Remove from favorites" : "Add to favorites"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Share with artist"
                      onClick={handleShare}
                      className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
                        <ShareIcon />
                      </span>
                      Share with artist
                    </button>
                    {activeVersion.audioUrl ? (
                      <a
                        role="menuitem"
                        aria-label="Download"
                        href={`/api/download/${activeVersion.id}`}
                        download
                        onClick={() => {
                          setOverflowOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[rgb(var(--fg-default)/0.04)]"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
                          <DownloadIcon />
                        </span>
                        Download audio
                      </a>
                    ) : (
                      <span
                        role="menuitem"
                        aria-label="Download"
                        aria-disabled
                        className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13px] font-semibold opacity-50"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]">
                          <DownloadIcon />
                        </span>
                        Download (uploading…)
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ───── Body ──────────────────────────────────────────────────
          Waveform first, then comments. The waveform card uses the
          double-bezel pattern — an outer hairline sheath + inner core
          with a soft inset highlight, so it sits on the page like a
          piece of polished hardware instead of a flat content rectangle. */}
      <section className="mx-auto max-w-[1120px] px-4 py-7 sm:px-6 sm:py-10">
        {/* Waveform — Double-Bezel card */}
        <div
          className="reveal-up rounded-[28px] p-[1.5px]"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--fg-default) / 0.08) 0%, rgb(var(--fg-default) / 0.02) 60%, rgb(var(--brand-primary) / 0.18) 100%)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div
            className="rounded-[26px] bg-[rgb(var(--bg-elevated))] p-6 sm:p-7"
            style={{
              boxShadow:
                "inset 0 1px 0 0 rgb(255 255 255 / 0.4), inset 0 -1px 0 0 rgb(var(--fg-default) / 0.04)",
            }}
          >
            <Waveform50
              durationMs={activeVersion.durationMs ?? 240_000}
              comments={waveformComments}
              seed={activeVersion.id}
              onProgress={setCurrentMs}
              height={120}
            />

            {/* In-context transport bar — Skip ±5s + slim Play in the
                waveform card so a producer can keep their eye on the
                wave without reaching back up to the hero. Same toggle
                path (handlePlayToggle) as the hero CTA, kept in lock-
                step by source-grep test. */}
            <div className="mt-6 flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const next = Math.max(0, currentMs - 5_000);
                  if (nowPlaying.trackId === activeVersion.id) {
                    playerSeek(next);
                  }
                  setCurrentMs(next);
                }}
                disabled={playState.disabled}
                aria-label="Back 5 seconds"
                title="Back 5 seconds"
                className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--fg-default)/0.04)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Skip5Icon dir="back" />
              </button>
              <button
                type="button"
                data-test="waveform-play-button"
                onClick={handlePlayToggle}
                disabled={playState.disabled}
                aria-label={playState.label}
                title={
                  playState.disabled ? "Audio is still uploading" : playState.label
                }
                className={[
                  "sk-press inline-flex h-14 w-14 items-center justify-center rounded-full",
                  "transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                  isPlayingThis
                    ? "bg-[rgb(var(--brand-primary))] text-white shadow-[0_0_0_6px_rgb(var(--brand-primary)/0.12),0_18px_36px_-10px_rgb(var(--brand-primary)/0.55)]"
                    : "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))] shadow-[0_12px_28px_-8px_rgb(var(--fg-default)/0.35)] hover:-translate-y-px hover:shadow-[0_18px_38px_-10px_rgb(var(--fg-default)/0.45)]",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                ].join(" ")}
              >
                {isPlayingThis ? <PauseIconLg /> : <PlayIconLg />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const dur = activeVersion.durationMs ?? 240_000;
                  const next = Math.min(dur, currentMs + 5_000);
                  if (nowPlaying.trackId === activeVersion.id) {
                    playerSeek(next);
                  }
                  setCurrentMs(next);
                }}
                disabled={playState.disabled}
                aria-label="Forward 5 seconds"
                title="Forward 5 seconds"
                className="sk-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--fg-default)/0.04)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Skip5Icon dir="fwd" />
              </button>
            </div>

            <p className="mt-5 text-center font-mono text-[10px] tracking-[0.16em] uppercase text-[rgb(var(--fg-muted))]">
              Click to seek · Drag to scrub · Hover to preview
            </p>
          </div>
        </div>

        {/* ───── Comments thread ─────────────────────────────────────
            Header → Composer → List. Composer floats at the top so the
            primary action (drop a note at the playhead) is the first
            thing a producer sees after the waveform. */}
        <div className="reveal-up reveal-up-delay-2 mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-display text-[20px] font-bold tracking-[-0.018em] text-[rgb(var(--fg-default))]">
                Notes
              </h2>
              <span className="font-mono text-[11px] font-bold tabular-nums text-[rgb(var(--fg-muted))]">
                {String(visibleComments.length)}
                {visibleComments.length !== allCommentsForVersion.length
                  ? ` of ${String(allCommentsForVersion.length)}`
                  : ""}
              </span>
            </div>
            {hasResolvedComments ? (
              <button
                type="button"
                onClick={() => {
                  setShowResolved((s) => !s);
                }}
                className="sk-press rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--fg-default)/0.04)] hover:text-[rgb(var(--fg-default))]"
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </button>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-[14px] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-[12px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          {/* Composer — premium pill, focus-state with amber ring. */}
          <div
            className={[
              "group/composer mb-5 flex items-center gap-2.5 rounded-full border bg-[rgb(var(--bg-elevated))] py-1.5 pl-2 pr-1.5",
              "border-[rgb(var(--border-subtle))]",
              "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              "focus-within:border-[rgb(var(--brand-primary)/0.5)] focus-within:shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.12)]",
            ].join(" ")}
          >
            <span className="shrink-0 rounded-full bg-[rgb(var(--brand-primary)/0.14)] px-2.5 py-1 font-mono text-[10.5px] font-bold tabular-nums text-[rgb(var(--brand-primary-dark))]">
              @{fmtMs(currentMs)}
            </span>
            <input
              ref={draftRef}
              type="text"
              maxLength={2000}
              placeholder="Add a note at this timestamp…"
              className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[rgb(var(--fg-muted))]"
              onFocus={handleComposerFocus}
              onBlur={handleComposerBlur}
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
              className="sk-press rounded-full bg-[rgb(var(--fg-default))] px-4 py-1.5 text-[11.5px] font-bold tracking-wide text-[rgb(var(--bg-elevated))] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-px hover:shadow-[0_8px_20px_-6px_rgb(var(--fg-default)/0.35)] disabled:opacity-60"
            >
              Post
            </button>
          </div>

          {visibleComments.length === 0 ? (
            <p className="rounded-[18px] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-10 text-center text-[13px] text-[rgb(var(--fg-muted))]">
              No notes yet on this version. Type one above to drop it at the
              current playhead.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleComments.map((c, i) => {
                const override = resolvedOverrides[c.id];
                const isResolved =
                  override !== undefined ? override : c.resolvedAtIso !== null;
                // Stagger entry by index, capped at 5 (after that the cascade
                // gets noticeably slow without adding polish).
                const staggerMs = Math.min(i, 5) * 50;
                return (
                  <li
                    key={c.id}
                    className={[
                      "group/note reveal-up",
                      "flex items-start gap-3 rounded-[18px] border px-4 py-3.5",
                      "transition-[transform,box-shadow,background-color,border-color] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
                      c.fromProducer
                        ? "border-[rgb(var(--brand-primary)/0.22)] bg-[rgb(var(--brand-primary)/0.05)]"
                        : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
                      isResolved
                        ? "opacity-55"
                        : "hover:-translate-y-px hover:shadow-[0_10px_28px_-12px_rgb(var(--fg-default)/0.16)]",
                    ].join(" ")}
                    style={{ animationDelay: `${String(staggerMs)}ms` }}
                  >
                    <span
                      aria-hidden
                      className={[
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold uppercase tracking-wider text-white",
                        c.fromProducer
                          ? "bg-[rgb(var(--brand-primary))] shadow-[0_2px_8px_-2px_rgb(var(--brand-primary)/0.55)]"
                          : "bg-[rgb(var(--fg-muted))]",
                      ].join(" ")}
                    >
                      {initials(c.authorName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                          {c.authorName}
                        </span>
                        <button
                          type="button"
                          data-test="comment-timestamp"
                          onClick={() => {
                            handleJumpToComment(c.timeMs);
                          }}
                          aria-label={`Jump to ${fmtMs(c.timeMs)}`}
                          className="sk-press rounded-full bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-[rgb(var(--brand-primary-dark))] transition-colors duration-200 hover:bg-[rgb(var(--brand-primary)/0.24)]"
                        >
                          @{fmtMs(c.timeMs)}
                        </button>
                        <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                          {fmtRelativeIso(c.createdAtIso)}
                        </span>
                        {isResolved ? (
                          <span className="rounded-full bg-[rgb(var(--fg-default)/0.06)] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
                            ✓ Resolved
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={[
                          "mt-1.5 text-[13.5px] leading-relaxed text-[rgb(var(--fg-default))]",
                          isResolved ? "" : "",
                        ].join(" ")}
                      >
                        {c.body}
                      </p>
                      <div className="mt-2.5 flex gap-3.5 text-[10.5px] font-bold tracking-wide opacity-0 transition-opacity duration-200 group-hover/note:opacity-100">
                        <button
                          type="button"
                          data-test="comment-jump"
                          onClick={() => {
                            handleJumpToComment(c.timeMs);
                          }}
                          className="text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                        >
                          Jump to
                        </button>
                        <button
                          type="button"
                          data-test="comment-reply"
                          onClick={() => {
                            handleReplyToComment(c.authorName);
                          }}
                          className="text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleResolveToggle(c);
                          }}
                          className="text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
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
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="10 4 6 8 10 12" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    <svg width="56" height="56" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
      <line x1="4" y1="14" x2="4" y2="18" opacity="0.7" />
      <line x1="8" y1="11" x2="8" y2="21" opacity="0.8" />
      <line x1="12" y1="7" x2="12" y2="25" opacity="0.95" />
      <line x1="16" y1="3" x2="16" y2="29" />
      <line x1="20" y1="7" x2="20" y2="25" opacity="0.95" />
      <line x1="24" y1="11" x2="24" y2="21" opacity="0.8" />
      <line x1="28" y1="14" x2="28" y2="18" opacity="0.7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
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

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function PlayIconLg() {
  return (
    <svg width="18" height="18" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function PauseIconLg() {
  return (
    <svg width="18" height="18" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="2" height="7" rx="0.5" />
      <rect x="7" y="2.5" width="2" height="7" rx="0.5" />
    </svg>
  );
}

function Skip5Icon({ dir }: { dir: "back" | "fwd" }) {
  // Circular skip arrow with a "5" inside the bow — the visual cue most
  // music apps use (Spotify, Apple Podcasts, Overcast). We mirror by
  // flipping the X transform for the forward variant.
  const transform = dir === "back" ? undefined : "scale(-1, 1) translate(-16, 0)";
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <g transform={transform}>
        <path
          d="M3 4 V 7 H 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M3.4 7 A 5.2 5.2 0 1 1 3 8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
      </g>
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize="6.2"
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill="currentColor"
      >
        5
      </text>
    </svg>
  );
}
