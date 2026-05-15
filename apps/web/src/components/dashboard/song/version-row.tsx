"use client";

import { Play, MessageSquare } from "lucide-react";

import {
  playerPlay,
  useNowPlaying,
} from "~/components/audio/persistent-player";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { formatDuration } from "~/lib/format/duration";

// VersionRow — single row in the Song Space's version-history list
// (DESIGN.md §5.5, BUILD-NOTES §6.6). Spotify/Samply-inspired, tightly
// gridded so version tags, durations and notes counts line up across
// rows.
//
// Grid columns (verbatim from BUILD-NOTES §6.6):
//   36px minmax(0,1fr) 48px 48px 56px 32px
//   ──── ─────────────── ──── ──── ──── ────
//   cover  title + meta   ver   dur  💬n   ▶
//
// Now-playing wiring: the row is clickable as a whole. onClick
// dispatches a PlayerTrack into the existing PersistentPlayer via
// `playerPlay()`. We subscribe to `useNowPlaying()` so the row can
// repaint itself when the dock starts playing this specific version,
// regardless of which row triggered the play (cross-row state).
//
// "Current" styling (when this version is the playing one):
//   - amber wash background (rgb(var(--brand-primary)/0.10))
//   - 3px amber left bar via the `before:` pseudo-element
//   - amber-tinted title / version tag / play button
//
// The first row of the Versions tab is the AddVersionDropZone, which
// reuses this grid geometry so the dropzone slots in flush.

export interface VersionRowVersionData {
  id: string;
  /** Display label like "v3" or "Master". */
  versionLabel: string;
  /** Direct R2/Cloudfront URL — fed straight to PlayerTrack.audioUrl. */
  audioUrl: string | null;
  /** ISO timestamp of upload (for the relative-when meta). */
  uploadedAtIso: string;
  /** "You" or the client/collab's display name. */
  uploadedBy: string;
  /** Short one-liner changelog ("Punched up the snare", "Final mix"). */
  changelog: string;
  /** Best-known duration in ms (DB column or live-decoded). */
  durationMs: number | null;
  /** Unresolved comment count — drives the 💬n cell. */
  noteCount: number;
}

interface VersionRowProps {
  version: VersionRowVersionData;
  /** The song's display title — fed to the PersistentPlayer title. */
  songTitle: string;
  /** The album/project name — first half of the player subtitle. */
  projectName: string;
}

// "5m ago" / "3d ago" / "Oct 14" — quick relative-time helper that
// keeps a stable shape inside the row's meta line. Uses ISO input so
// the parent server component can pass a pre-formatted string without
// worrying about timezone drift between server + client renders.
function relativeWhen(iso: string): string {
  let d: Date;
  try {
    d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
  } catch {
    return iso;
  }
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function VersionRow({
  version,
  songTitle,
  projectName,
}: VersionRowProps) {
  const { trackId } = useNowPlaying();
  const isCurrent = trackId === version.id;

  const coverBg = producerGradient(songTitle);
  const versionLabel = version.versionLabel;

  const metaParts: string[] = [];
  if (version.uploadedBy) metaParts.push(`by ${version.uploadedBy}`);
  metaParts.push(relativeWhen(version.uploadedAtIso));
  if (version.changelog) metaParts.push(version.changelog);
  const meta = metaParts.join(" · ");

  // No-audio rows MUST NOT dispatch a play. Without this gate the
  // PersistentPlayer would receive `audioUrl: null`, paint the row as
  // "current" via the amber wash, but silently fail to load any audio —
  // the user sees a "playing" state with no sound and no feedback. Bail
  // early so the click is a true no-op for empty rows.
  const hasAudio = version.audioUrl !== null;
  const handlePlay = () => {
    if (version.audioUrl === null) return;
    playerPlay({
      id: version.id,
      audioUrl: version.audioUrl,
      title: songTitle,
      subtitle: `${projectName} · ${versionLabel}`,
      durationMs: version.durationMs,
    });
  };

  // Background + foreground tokens flip when the row is now-playing.
  const rowBg = isCurrent
    ? "rgb(var(--brand-primary)/0.10)"
    : "rgb(var(--bg-background))";
  const titleColor = isCurrent
    ? "rgb(var(--brand-primary))"
    : "rgb(var(--fg-default))";
  const versionColor = isCurrent
    ? "rgb(var(--brand-primary))"
    : "rgb(var(--fg-muted))";
  const playBg = isCurrent
    ? "rgb(var(--brand-primary))"
    : "transparent";
  const playColor = isCurrent
    ? "rgb(var(--bg-sidebar))"
    : "rgb(var(--fg-default))";

  // The 3px amber left bar is a `::before` pseudo via Tailwind's
  // before:* utilities. Only painted when current.
  const beforeClass = isCurrent
    ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[rgb(var(--brand-primary))] before:content-['']"
    : "";

  return (
    <button
      type="button"
      onClick={handlePlay}
      data-version-id={version.id}
      data-current={isCurrent ? "true" : "false"}
      aria-disabled={!hasAudio}
      className={`group relative grid w-full items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors hover:bg-[rgb(var(--bg-elevated))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] ${beforeClass} ${hasAudio ? "" : "cursor-not-allowed opacity-60"}`}
      style={{
        gridTemplateColumns: "36px minmax(0,1fr) 48px 48px 56px 32px",
        borderColor: "rgb(var(--border-subtle))",
        background: rowBg,
      }}
      aria-label={
        hasAudio ? `Play ${songTitle} ${versionLabel}` : "No audio available"
      }
    >
      {/* 1 — 36px gradient cover tile */}
      <span
        aria-hidden
        className="relative z-10 h-[36px] w-[36px] shrink-0 rounded-[var(--radius-sm)]"
        style={{ background: coverBg }}
      />

      {/* 2 — Title + meta (truncates) */}
      <div className="relative z-10 min-w-0">
        <p
          className="truncate text-[14px] font-medium leading-tight transition-colors"
          style={{ color: titleColor }}
        >
          {songTitle}
        </p>
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {meta}
        </p>
      </div>

      {/* 3 — Version tag (mono, no chip background) */}
      <span
        className="relative z-10 font-mono text-[12px] tabular-nums"
        style={{ color: versionColor }}
      >
        {versionLabel}
      </span>

      {/* 4 — Duration (mono mm:ss) */}
      <span
        className="relative z-10 font-mono text-[12px] tabular-nums"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {formatDuration(version.durationMs)}
      </span>

      {/* 5 — Comment count (chat bubble icon + count) */}
      <span
        className="relative z-10 inline-flex items-center gap-1 text-[12px] tabular-nums"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        <MessageSquare size={12} aria-hidden />
        {version.noteCount}
      </span>

      {/* 6 — Play button (28px CIRCLE, amber when current). G25:
          design HTML 586–590 uses `border-radius:50%` for the
          iconic round play affordance, not a rounded square. */}
      <span
        aria-hidden
        className="relative z-10 inline-flex h-[28px] w-[28px] items-center justify-center rounded-full border transition-colors"
        style={{
          background: playBg,
          borderColor: isCurrent
            ? "rgb(var(--brand-primary))"
            : "rgb(var(--border-subtle))",
          color: playColor,
        }}
      >
        <Play
          size={12}
          fill="currentColor"
          aria-label={hasAudio ? "Play" : "No audio available"}
        />
      </span>
    </button>
  );
}
