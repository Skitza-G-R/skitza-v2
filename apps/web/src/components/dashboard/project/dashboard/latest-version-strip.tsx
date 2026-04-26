"use client";

// Project Dashboard — Latest version strip (Story 04, PRD §11.5).
//
// Embedded play button + waveform-style track row + "sent <relative>"
// label. Click the title → Link to Music tab + scroll-to-version. The
// play button hands off to the existing PersistentPlayer (the
// Spotify-style bottom dock that lives in AppShell) — we don't embed
// a fresh HTMLAudioElement here; using the same player is what keeps
// audio playing across tab switches and dashboard navigation.
//
// Hides entirely when latestVersion is null (silence > "no tracks
// yet" placeholder per story spec).

import Link from "next/link";

import { playerPlay } from "~/components/audio/persistent-player";
import { formatRelativeTime } from "~/lib/time/relative";

import { buildVersionJumpHref } from "./dashboard-helpers";

export interface LatestVersion {
  trackId: string;
  trackTitle: string;
  versionId: string;
  versionLabel: string;
  audioUrl: string | null;
  sentAt: Date;
  statusEnum: string;
}

export interface LatestVersionStripProps {
  latestVersion: LatestVersion | null;
  projectId: string;
}

export function LatestVersionStrip({
  latestVersion,
  projectId,
}: LatestVersionStripProps) {
  if (!latestVersion) {
    // Silent empty — story spec.
    return null;
  }

  const playable = latestVersion.audioUrl !== null;
  const href = buildVersionJumpHref({
    projectId,
    versionId: latestVersion.versionId,
  });

  return (
    <section
      aria-label="Latest version"
      className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 sm:p-4"
    >
      <button
        type="button"
        disabled={!playable}
        aria-label={
          playable
            ? `Play ${latestVersion.trackTitle} ${latestVersion.versionLabel}`
            : "Audio not yet available"
        }
        onClick={() => {
          if (!playable) return;
          playerPlay({
            id: latestVersion.versionId,
            audioUrl: latestVersion.audioUrl,
            title: latestVersion.trackTitle,
            subtitle: latestVersion.versionLabel,
            durationMs: null,
          });
        }}
        className={[
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
          playable
            ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] hover:scale-105 sk-lift"
            : "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-muted))] cursor-not-allowed",
        ].join(" ")}
      >
        {/* Play glyph — pure CSS triangle, no svg dependency. */}
        <span
          aria-hidden="true"
          className={[
            "ml-0.5 inline-block",
            "border-y-[7px] border-l-[10px] border-y-transparent",
            playable
              ? "border-l-[rgb(var(--fg-inverse))]"
              : "border-l-[rgb(var(--fg-muted))]",
          ].join(" ")}
          style={{ borderRightWidth: 0 }}
        />
      </button>

      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className={[
            "block truncate text-sm font-semibold text-[rgb(var(--fg-primary))] transition-colors",
            "hover:text-[rgb(var(--brand-primary))]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] rounded",
          ].join(" ")}
        >
          {latestVersion.trackTitle}{" "}
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            · {latestVersion.versionLabel}
          </span>
        </Link>
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
          Sent {formatRelativeTime(latestVersion.sentAt)}
        </p>
      </div>

      {/* Static waveform glyph — the real waveform renders inside the
          PersistentPlayer dock. Here we just hint at audio with a few
          static bars so the row reads as "this is a track". */}
      <div
        aria-hidden="true"
        className="hidden items-end gap-0.5 h-7 sm:flex"
      >
        {WAVEFORM_BARS.map((h, i) => (
          <span
            key={`bar-${String(i)}`}
            className="w-0.5 rounded-sm bg-[rgb(var(--fg-muted)/0.4)]"
            style={{ height: `${String(h)}%` }}
          />
        ))}
      </div>
    </section>
  );
}

// Pre-computed bar heights for the static waveform glyph. Hardcoded
// rather than randomised so SSR + client renders agree.
const WAVEFORM_BARS = [
  20, 35, 55, 70, 60, 80, 50, 65, 90, 70, 55, 40, 60, 75, 50, 30,
];
