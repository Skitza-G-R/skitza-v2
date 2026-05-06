"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EqBars } from "~/components/audio/eq-bars";
import { useNowPlaying } from "~/components/audio/persistent-player";
import { Chips } from "~/components/ui/chips";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { fmtDateTime, formatRelativeTime } from "~/lib/time/relative";

// Phase 4 — Music Library list screen.
//
// Mirrors `notes/producer-screens-2.jsx` LibraryList:
//   • Filter chips (Recent / All).
//   • Dashed Upload CTA at the top of the list (no upload backend
//     wired here yet; opens /dashboard/music/upload when implemented).
//   • Track rows: gradient client-cover (square, 42px) + title +
//     client · version · uploaded relative — duration on the right.
//
// Replaces the prior Spotify-style cover-card grid that produced
// dense color blocks but lost the "what is this and when did it
// land" answer at a glance. The list reads as a feed of the
// producer's most-recent uploads.
//
// Click target = full row → deep-links into the Project Room's
// Music sub-tab with ?version=<id>. Same router contract as the
// prior MusicLibrary component; consumers re-using that contract
// (e.g. the Today recent-uploads shelf) keep working.

export interface MusicLibraryRow {
  id: string;
  trackTitle: string;
  label: string;
  projectId: string;
  projectTitle: string;
  clientName: string | null;
  uploadedAtIso: string;
  audioUrl: string | null;
}

const FILTER_ITEMS = [
  { value: "recent", label: "Recent" },
  { value: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTER_ITEMS)[number]["value"];

export function MusicLibraryScreen({ tracks }: { tracks: MusicLibraryRow[] }) {
  const [filter, setFilter] = useState<FilterKey>("recent");

  const filtered = useMemo(() => {
    if (filter === "all") return tracks;
    // Recent = last 30 days. Anchored to the iso string so we don't
    // re-render on every clock tick.
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return tracks.filter((t) => {
      const ts = Date.parse(t.uploadedAtIso);
      return Number.isFinite(ts) && now - ts <= thirtyDaysMs;
    });
  }, [tracks, filter]);

  return (
    <div className="flex flex-col gap-4">
      <Chips<FilterKey>
        ariaLabel="Filter library"
        items={[...FILTER_ITEMS]}
        value={filter}
        onChange={setFilter}
      />

      {/* Upload CTA — dashed, sk-press tactile. Routes to the
          existing audio upload entry once it's wired; for now the
          link goes to the Project Room's Music sub-tab where uploads
          actually happen today. */}
      <Link
        href="/dashboard/clients-projects?action=upload"
        className="sk-press flex items-center justify-center gap-2 rounded-[var(--radius-lg)] border-[1.5px] border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        <PlusIcon />
        Upload new version
      </Link>

      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          {tracks.length === 0
            ? "No uploads yet."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((row) => (
            <li key={row.id}>
              <TrackRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackRow({ row }: { row: MusicLibraryRow }) {
  const uploadedAt = new Date(row.uploadedAtIso);
  const clientName = row.clientName ?? row.projectTitle;
  // Highlight the row that's currently playing in the persistent player —
  // this is what hooks the EqBars equalizer animation to "real" play state.
  // Subscribes via the module-level pub-sub on PersistentPlayer; rerenders
  // only when the playing-track flips.
  const nowPlaying = useNowPlaying();
  const isCurrent = nowPlaying.trackId === row.id;
  const isPlayingHere = isCurrent && nowPlaying.playing;
  return (
    <Link
      // L3 deep-link — every row opens the song page, where the producer
      // gets the full waveform + comments thread. The project-room route
      // is now a secondary jump from inside the L3 hero.
      href={`/dashboard/music/${row.id}`}
      aria-current={isCurrent ? "true" : undefined}
      className={[
        "sk-press flex items-center gap-3 rounded-[var(--radius-md)] border bg-[rgb(var(--bg-elevated))] px-3 py-2.5",
        isCurrent
          ? "border-[rgb(var(--brand-primary)/0.55)] shadow-[0_0_0_1px_rgb(var(--brand-primary)/0.2)]"
          : "border-[rgb(var(--border-subtle))]",
      ].join(" ")}
    >
      {/* Square gradient cover — ports the design's per-client hue
          art card to the producer side. 42px matches the visual
          rhythm of mobile track lists; on lg+ this can grow. */}
      <div
        aria-hidden
        className="relative h-[42px] w-[42px] shrink-0 overflow-hidden rounded-[var(--radius-sm)]"
        style={{ background: producerGradient(clientName) }}
      >
        {/* Faint waveform glyph so the cover reads as a music asset
            rather than a plain colour block. */}
        <svg
          viewBox="0 0 42 42"
          className="absolute inset-0 h-full w-full opacity-40"
          aria-hidden
        >
          <g fill="rgb(255 255 255 / 0.6)">
            {WAVEFORM_BARS.map((bar) => (
              <rect
                key={bar.x}
                x={bar.x - 1}
                y={21 - bar.h / 2}
                width="2"
                height={bar.h}
                rx="1"
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={[
            "flex items-center gap-1.5 truncate text-[13.5px] font-bold leading-tight",
            isCurrent
              ? "text-[rgb(var(--brand-primary-dark))]"
              : "text-[rgb(var(--fg-default))]",
          ].join(" ")}
        >
          {isCurrent ? (
            <span
              aria-hidden
              className="shrink-0 text-[rgb(var(--brand-primary-dark))]"
            >
              <EqBars playing={isPlayingHere} size={11} />
            </span>
          ) : null}
          <span className="truncate">{row.trackTitle}</span>
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {clientName}
          {" · "}
          <span className="font-mono">{row.label}</span>
          {" · "}
          {/* Use formatRelativeTime so the date matches the rest of
              the dashboard's relative-time conventions. fmtDateTime
              is the long-form fallback for screen readers. */}
          <time
            dateTime={row.uploadedAtIso}
            title={fmtDateTime(uploadedAt)}
            className="font-mono"
          >
            {formatRelativeTime(uploadedAt)}
          </time>
        </p>
      </div>
    </Link>
  );
}

// Static waveform bar geometry for the gradient cover. Centered on
// y=21 (the SVG's vertical midline) so each bar grows symmetrically
// up + down from the centre line. Six bars across a 42px tile.
const WAVEFORM_BARS: ReadonlyArray<{ x: number; h: number }> = [
  { x: 6, h: 8 },
  { x: 12, h: 18 },
  { x: 18, h: 12 },
  { x: 24, h: 22 },
  { x: 30, h: 16 },
  { x: 36, h: 10 },
];

function PlusIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  );
}
