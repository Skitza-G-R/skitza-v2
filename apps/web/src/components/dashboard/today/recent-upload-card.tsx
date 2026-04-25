"use client";

import { TrackCover } from "../../audio/track-cover";
import { PLAYER_EVENTS, type PlayerTrack } from "../../audio/persistent-player";
import { formatRelativeTime } from "../../../lib/time/relative";
import type { RecentUpload } from "../../../server/trpc/routers/producer";
import { badgeText, cardHref, cardPlayDetail } from "./recent-uploads-shelf";

// One card in the RecentUploadsShelf. Visual recipe:
//
//   ┌──────────────┐
//   │  GRADIENT    │ ← TrackCover (deterministic, hash-derived from trackId)
//   │  COVER       │ ← play-button overlay fades in at group-hover (80% opacity)
//   │   ●3 (badge) │ ← unread-comments badge, top-end corner (RTL-aware)
//   └──────────────┘
//   Sunset Mix · v3
//   Bob's EP · 2h ago
//
// Click the card → deep-links to the project room music tab with
// `?versionId=` set so the version is pre-selected. Click the play
// overlay → dispatches the existing PersistentPlayer's `set` event
// (skitza:player:set). The card is the dispatcher, NOT a new audio
// implementation — the persistent player handles all <audio>
// machinery (preload, scrub, ended). See persistent-player.tsx for
// the event contract.
//
// RTL discipline: position the badge with `-end-1` (logical), not
// `right-1` (physical). Under `dir="rtl"` the badge mirrors to the
// top-left automatically — the visual semantic is "trailing corner of
// the cover," which is what we want regardless of locale direction.

interface RecentUploadCardProps {
  upload: RecentUpload;
}

export function RecentUploadCard({ upload }: RecentUploadCardProps) {
  const badge = badgeText(upload.unreadComments);

  function onPlay(e: React.MouseEvent<HTMLButtonElement>) {
    // Stop the surrounding <a> from firing — we don't want clicking
    // the play overlay to also navigate to the project room.
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === "undefined") return;
    const detail: PlayerTrack = cardPlayDetail(upload);
    window.dispatchEvent(new CustomEvent(PLAYER_EVENTS.set, { detail }));
  }

  return (
    <a
      href={cardHref(upload)}
      className="group flex w-36 shrink-0 flex-col gap-2"
    >
      <div className="relative">
        <TrackCover trackId={upload.trackId} size={144} />
        {/* Play-button overlay. Sits absolutely over the cover and
            stays invisible until group-hover or keyboard focus on
            the button itself reveals it. The `bg-black/40` sits
            on top of the gradient at 40% to keep the play icon
            readable; opacity-100 fades the whole stack in. */}
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${upload.title} ${upload.versionLabel}`}
          className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-md)] bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <PlayOverlayIcon />
        </button>
        {/* Unread-comments badge. Capped to "99+" by `badgeText`. The
            ring-2 with --bg-base creates the "punched out of the
            cover" effect when the badge sits over the rounded
            gradient corner. */}
        {badge !== null && (
          <span
            aria-label={`${String(upload.unreadComments)} unread comments`}
            className="absolute -end-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.65rem] font-semibold text-[rgb(var(--fg-inverse))] ring-2 ring-[rgb(var(--bg-base))]"
          >
            {badge}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[rgb(var(--fg-primary))]">
          {upload.title}
          <span className="ms-1 font-mono text-xs font-normal text-[rgb(var(--fg-muted))]">
            · {upload.versionLabel}
          </span>
        </p>
        <p className="truncate text-xs text-[rgb(var(--fg-secondary))]">
          {upload.projectClientName} · {formatRelativeTime(upload.uploadedAt)}
        </p>
      </div>
    </a>
  );
}

// 32×32 white triangle on the play overlay. Same iconographic style
// as PersistentPlayer's PlayIcon, scaled up so the affordance reads
// at a glance over a 144×144 cover.
function PlayOverlayIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={32}
      height={32}
      fill="white"
      aria-hidden
      className="drop-shadow"
    >
      <path d="M11 8.5v15L24 16z" />
    </svg>
  );
}
