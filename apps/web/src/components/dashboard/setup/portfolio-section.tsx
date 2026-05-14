"use client";

// Producer's public portfolio list — Profile → Portfolio tab and the
// legacy Setup page consume this same component.
//
// Behavior contract (post-F9 iteration):
//   * Every track in the portfolio is publicly visible on /join/<slug>.
//     The legacy "Public sample" per-track toggle is gone — the public
//     profile IS the public surface, no opt-in step.
//   * Each row has inline Edit (title + artist) and Remove buttons.
//   * Title is required; artist is free-text and may be cleared.
//
// State model:
//   * `rows`: optimistic copy of `tracks` prop. Synced via useEffect
//     when the parent re-fetches (F9 picker -> router.refresh ->
//     fresh tracks prop). Sibling ExternalLinksSection follows the
//     same pattern.
//   * `editingId`: the row currently in inline edit mode, or null.
//   * `removingId`: the row in the middle of a delete round-trip.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";
import {
  deletePortfolioTrack,
  updatePortfolioTrack,
} from "~/app/(producer)/dashboard/portfolio/actions";

export type PortfolioTrackRow = {
  id: string;
  title: string;
  artist: string | null;
  // Vestigial — kept on the type so producer/page.tsx + settings/page.tsx
  // mappings don't need to churn while we deprecate the column.
  isPublicSample: boolean;
};

export function PortfolioSection({ tracks }: { tracks: PortfolioTrackRow[] }) {
  const [rows, setRows] = useState<PortfolioTrackRow[]>(tracks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftArtist, setDraftArtist] = useState("");
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  // Sync rows when the parent re-fetches tracks (F9 "Add from music
  // library" picker calls router.refresh on success → server re-runs
  // the page query → fresh tracks array via props). Without this,
  // useState's initial value freezes the list and new tracks (or
  // edits/removes from another tab) wouldn't appear until a hard
  // browser refresh remounts the component.
  useEffect(() => {
    setRows(tracks);
  }, [tracks]);

  function startEdit(t: PortfolioTrackRow) {
    setEditingId(t.id);
    setDraftTitle(t.title);
    setDraftArtist(t.artist ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftTitle("");
    setDraftArtist("");
  }

  function saveEdit(id: string) {
    const title = draftTitle.trim();
    const artist = draftArtist.trim();
    if (title.length === 0) {
      toast("Title is required.", "error");
      return;
    }
    // Optimistic — the row updates instantly; if the server call fails,
    // we fall back to the server-truth `tracks` prop.
    setRows((all) =>
      all.map((r) =>
        r.id === id
          ? { ...r, title, artist: artist.length > 0 ? artist : null }
          : r,
      ),
    );
    setEditingId(null);
    setPendingEditId(id);
    startTransition(async () => {
      const res = await updatePortfolioTrack({ id, title, artist });
      setPendingEditId(null);
      if (!res.ok) {
        toast(res.error, "error");
        setRows(tracks);
        return;
      }
      router.refresh();
    });
  }

  function remove(t: PortfolioTrackRow) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Remove "${t.title}" from your public portfolio?`,
      );
      if (!confirmed) return;
    }
    setRemovingId(t.id);
    setRows((all) => all.filter((r) => r.id !== t.id));
    startTransition(async () => {
      const res = await deletePortfolioTrack({ id: t.id });
      setRemovingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        setRows(tracks);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section>
      {rows.length === 0 ? (
        <PortfolioEmpty />
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {rows.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              isEditing={editingId === t.id}
              draftTitle={draftTitle}
              draftArtist={draftArtist}
              pendingEdit={pendingEditId === t.id}
              pendingRemove={removingId === t.id}
              onStartEdit={() => {
                startEdit(t);
              }}
              onCancelEdit={cancelEdit}
              onChangeDraftTitle={setDraftTitle}
              onChangeDraftArtist={setDraftArtist}
              onSave={() => {
                saveEdit(t.id);
              }}
              onRemove={() => {
                remove(t);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PortfolioEmpty() {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
    >
      You haven&rsquo;t uploaded any portfolio tracks yet.
    </div>
  );
}

function TrackRow({
  track,
  isEditing,
  draftTitle,
  draftArtist,
  pendingEdit,
  pendingRemove,
  onStartEdit,
  onCancelEdit,
  onChangeDraftTitle,
  onChangeDraftArtist,
  onSave,
  onRemove,
}: {
  track: PortfolioTrackRow;
  isEditing: boolean;
  draftTitle: string;
  draftArtist: string;
  pendingEdit: boolean;
  pendingRemove: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeDraftTitle: (v: string) => void;
  onChangeDraftArtist: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const disabled = pendingEdit || pendingRemove;

  if (isEditing) {
    return (
      <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-end sm:gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Title
          </span>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => {
              onChangeDraftTitle(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              } else if (e.key === "Escape") {
                onCancelEdit();
              }
            }}
            maxLength={200}
            required
            autoFocus
            className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Artist (optional)
          </span>
          <input
            type="text"
            value={draftArtist}
            onChange={(e) => {
              onChangeDraftArtist(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              } else if (e.key === "Escape") {
                onCancelEdit();
              }
            }}
            maxLength={200}
            className="h-9 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
        </label>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || draftTitle.trim().length === 0}
            className="inline-flex h-9 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingEdit ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={disabled}
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 600 }}
        >
          {track.title}
        </p>
        {track.artist ? (
          <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">
            {track.artist}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onStartEdit}
          disabled={disabled}
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingRemove ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}
