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
  const handleAddSong = (slot?: EmptySongSpaceRowData) => {
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
          {canAddSong ? "No songs yet — add the first one to get started." : blockedReason}
        </p>
        {canAddSong ? (
          <p className="mt-2 text-[13px]" style={{ color: "rgb(var(--fg-muted))" }}>
            Purchased song spaces stay visible here before audio is uploaded.
          </p>
        ) : null}
        {canAddSong ? (
          <button
            type="button"
            onClick={() => {
              handleAddSong();
            }}
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold shadow-[var(--shadow-sm)] transition-colors"
            style={{
              background: "rgb(var(--brand-primary))",
              color: "rgb(var(--bg-sidebar))",
            }}
          >
            <Plus size={14} />
            Add song
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section role="tabpanel" id="panel-songs" aria-labelledby="tab-songs" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-syne text-[18px] font-bold" style={{ color: "rgb(var(--fg-default))" }}>
          Tracklist
        </h3>
        {canAddSong ? (
          <button
            type="button"
            onClick={() => {
              handleAddSong();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{
              background: "transparent",
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-default))",
            }}
          >
            <Plus size={12} />
            Add song
          </button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            projectId={projectId}
            track={t}
            index={i + 1}
          />
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
