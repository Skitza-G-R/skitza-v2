"use client";

import { TrackRow, type TrackRowData } from "~/components/dashboard/project/track-row";

// SongsTab — Songs panel for the new Album Page (DESIGN.md §4.3,
// BUILD-NOTES §5.3). Renders the Tracklist header + list of
// <TrackRow>s, or an empty state when no tracks exist yet.
//
// The Project route supplies durable Songs only. Purchased capacity and
// incomplete uploads never render as Song rows.

interface SongsTabProps {
  tracks: TrackRowData[];
  canAddSong?: boolean;
  blockedReason?: string;
}

export function SongsTab({
  tracks,
  canAddSong = true,
  blockedReason = "New work requires an active project and an active purchase or accepted offer.",
}: SongsTabProps) {
  if (tracks.length === 0) {
    return (
      <section
        role="tabpanel"
        id="panel-songs"
        aria-labelledby="tab-songs"
        className="rounded-[var(--radius-lg)] border px-6 py-10 text-center"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <p className="font-syne text-[18px] font-bold" style={{ color: "rgb(var(--fg-default))" }}>
          {canAddSong ? "No songs yet." : blockedReason}
        </p>
        {canAddSong ? (
          <p className="mt-2 text-[13px]" style={{ color: "rgb(var(--fg-muted))" }}>
            Use the project + button to add the first song.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section role="tabpanel" id="panel-songs" aria-labelledby="tab-songs" className="space-y-3">
      <div>
        <h2 className="font-syne text-[18px] font-bold" style={{ color: "rgb(var(--fg-default))" }}>
          Songs
        </h2>
        <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
          Open a song in the player, or use Play to start the mini-player.
        </p>
      </div>

      <div className="space-y-2">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i + 1} />
        ))}
      </div>
    </section>
  );
}
