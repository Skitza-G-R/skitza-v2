"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import {
  TrackRow,
  type TrackRowData,
} from "~/components/dashboard/project/track-row";
import { UploadTrackModal } from "~/components/dashboard/song/upload-track-modal";

// SongsTab — Songs panel for the new Album Page (DESIGN.md §4.3,
// BUILD-NOTES §5.3). Renders the Tracklist header + list of
// <TrackRow>s, or an empty state when no tracks exist yet.
//
// Drag-and-drop is owned locally for optimistic feedback. When the
// drop fires we call back to the parent via `onReorder(orderedIds)`
// — the parent owns the tRPC mutation (Phase 4 wires the real
// `project.reorderTracks` call). The local order resyncs to props
// whenever the parent re-renders with a fresh `tracks` list.
//
// Phase 4: "+ Add song" opens the UploadTrackModal (mode="new-song").
// We own the open/close state locally so the modal is colocated with
// the button that summons it. The parent doesn't need an onAddSong
// callback anymore (it's still accepted for backward-compat callers
// that want to override the default open behaviour).

interface SongsTabProps {
  projectId: string;
  tracks: TrackRowData[];
  /** Optional override — if not provided, "+ Add song" opens the modal. */
  onAddSong?: () => void;
  onReorder?: (orderedIds: string[]) => unknown;
}

export function SongsTab({
  projectId,
  tracks,
  onAddSong,
  onReorder,
}: SongsTabProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  // The modal needs the same id+title+versionCount projection on every
  // track in the project, so the producer can pick an existing song
  // from the dropdown. `versionCount ?? 0` keeps the modal's default
  // label deterministic even if the parent forgot to thread it.
  const modalTracks = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    versionCount: t.versionCount ?? 0,
  }));
  const handleAddSong = () => {
    if (onAddSong) {
      onAddSong();
      return;
    }
    setUploadOpen(true);
  };
  // Local mirror of the incoming order — enables optimistic reorder
  // without waiting on the server round-trip. Reset when props change.
  const [ordered, setOrdered] = useState<TrackRowData[]>(tracks);
  useEffect(() => {
    setOrdered(tracks);
  }, [tracks]);

  const [dragId, setDragId] = useState<string | null>(null);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    id: string,
  ) => {
    void e;
    setDragId(id);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    id: string,
  ) => {
    // Allow drop — without this, the drop event never fires.
    void id;
    e.preventDefault();
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    targetId: string,
  ) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const fromIndex = ordered.findIndex((t) => t.id === dragId);
    const toIndex = ordered.findIndex((t) => t.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDragId(null);
      return;
    }
    const next = [...ordered];
    const removed = next.splice(fromIndex, 1)[0];
    if (removed) {
      next.splice(toIndex, 0, removed);
      setOrdered(next);
      onReorder?.(next.map((t) => t.id));
    }
    setDragId(null);
  };

  // Shared modal mount used by both render branches — colocated with
  // the SongsTab so the open state lives where the trigger lives.
  const modal = (
    <UploadTrackModal
      open={uploadOpen}
      onClose={() => {
        setUploadOpen(false);
      }}
      projectId={projectId}
      mode="new-song"
      tracks={modalTracks}
    />
  );

  if (ordered.length === 0) {
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
        <p
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          No songs yet — upload the first one to get started.
        </p>
        <p
          className="mt-2 text-[13px]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          Tracks you upload here show up in the artist&apos;s music library.
        </p>
        <button
          type="button"
          onClick={handleAddSong}
          className="mt-5 inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold shadow-[var(--shadow-sm)] transition-colors"
          style={{
            background: "rgb(var(--brand-primary))",
            color: "rgb(var(--bg-sidebar))",
          }}
        >
          <Plus size={14} />
          Add song
        </button>
        {modal}
      </section>
    );
  }

  return (
    <section
      role="tabpanel"
      id="panel-songs"
      aria-labelledby="tab-songs"
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          Tracklist
        </h3>
        <button
          type="button"
          onClick={handleAddSong}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            background: "transparent",
            borderColor: "rgb(var(--border-subtle))",
            color: "rgb(var(--fg-default))",
          }}
        >
          <Plus size={12} />
          Add song
        </button>
      </div>

      <div className="space-y-1.5">
        {ordered.map((t, i) => (
          <TrackRow
            key={t.id}
            projectId={projectId}
            track={t}
            index={i + 1}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
      </div>
      {modal}
    </section>
  );
}
