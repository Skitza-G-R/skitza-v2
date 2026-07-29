"use client";

import { Plus } from "lucide-react";

import { TrackRow, type TrackRowData } from "~/components/dashboard/project/track-row";

export interface EmptySongSpaceRowData {
  id: string;
  purchaseId: string;
  label: string;
}

// SongsTab — Songs panel for the new Album Page (DESIGN.md §4.3,
// BUILD-NOTES §5.3). Renders the Tracklist header + list of
// <TrackRow>s, or an empty state when no tracks exist yet.
//
// "+ Add song" delegates to the purchased-song-space flow. Claiming
// a space and uploading audio are separate actions, so an allocated
// song remains visible even before it has a version.

interface SongsTabProps {
  projectId: string;
  tracks: TrackRowData[];
  emptySlots?: readonly EmptySongSpaceRowData[];
  canAddSong?: boolean;
  blockedReason?: string;
  /** Opens the chooser, optionally pinned to the exact visible entitlement. */
  onAddSong?: (slot?: EmptySongSpaceRowData) => void;
}

export function SongsTab({
  projectId,
  tracks,
  emptySlots = [],
  canAddSong = true,
  blockedReason = "New work requires an active project and an active purchase or accepted offer.",
  onAddSong,
}: SongsTabProps) {
  const handleAddSong = (slot: EmptySongSpaceRowData) => {
    if (!canAddSong) return;
    onAddSong?.(slot);
  };
  if (tracks.length === 0 && emptySlots.length === 0) {
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
          Open a song for details, or use Play to start the mini-player.
        </p>
      </div>

      <div className="space-y-2">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} projectId={projectId} track={t} index={i + 1} />
        ))}
        {emptySlots.map((slot) => (
          <div
            key={slot.id}
            className="flex min-h-14 items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 sm:px-4"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.13)] text-[rgb(var(--brand-primary-dark))]">
              <Plus size={15} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                {slot.label}
              </span>
              <span className="block text-[11.5px] text-[rgb(var(--fg-muted))]">
                Purchased song space · ready to name
              </span>
            </span>
            {canAddSong ? (
              <button
                type="button"
                onClick={() => {
                  handleAddSong(slot);
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[12px] font-semibold text-[rgb(var(--bg-sidebar))]"
              >
                Add song
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
