"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { createTrack, deleteTrack } from "./actions";

interface AddTrackFormProps {
  onClose: () => void;
}

function AddTrackForm({ onClose }: AddTrackFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [artworkUrl, setArtworkUrl] = useState("");

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTrack({
        title,
        ...(artist ? { artist } : {}),
        audioUrl,
        ...(artworkUrl ? { artworkUrl } : {}),
      });
      if (res.ok) {
        setTitle("");
        setArtist("");
        setAudioUrl("");
        setArtworkUrl("");
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 reveal-up"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); }}
            placeholder="Untitled track"
            required
          />
        </div>
        <div>
          <Label htmlFor="artist">Artist (optional)</Label>
          <Input
            id="artist"
            type="text"
            value={artist}
            onChange={(e) => { setArtist(e.target.value); }}
            placeholder="Featured artist"
          />
        </div>
        <div>
          <Label htmlFor="audioUrl">Audio URL</Label>
          <Input
            id="audioUrl"
            type="url"
            value={audioUrl}
            onChange={(e) => { setAudioUrl(e.target.value); }}
            placeholder="https://…"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="artworkUrl">Artwork URL (optional)</Label>
          <Input
            id="artworkUrl"
            type="url"
            value={artworkUrl}
            onChange={(e) => { setArtworkUrl(e.target.value); }}
            placeholder="https://…"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Saving…" : "Save track"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteTrackButton({ trackId }: { trackId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTrack({ id: trackId });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {confirm ? (
        <div className="flex items-center gap-1">
          <Button type="button" variant="destructive" size="sm" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Confirm"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirm(false); }} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => { setConfirm(true); }}>
          Delete
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Toolbar shown next to the page header — Add track toggle + inline form. */
function PortfolioToolbar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open ? (
        <Button onClick={() => { setOpen(true); }}>+ Add track</Button>
      ) : (
        <Button variant="ghost" onClick={() => { setOpen(false); }}>
          Close
        </Button>
      )}
      {open ? <InlineFormPortal onClose={() => { setOpen(false); }} /> : null}
    </>
  );
}

// Bottom-sheet overlay for the add-track form. Fixed to viewport + backdrop
// so it spans the full width regardless of where the trigger button sits in
// the header flex row. Keydown Escape closes. Small detail: lock body scroll
// while the sheet is open on mobile so the background doesn't drift under it.
function InlineFormPortal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[rgb(var(--bg-sunken)/0.65)] backdrop-blur-sm sm:items-center">
      {/* Backdrop click closes */}
      <button
        type="button"
        aria-label="Close form"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative z-10 w-full max-w-2xl px-0 pb-0 sm:px-4 sm:pb-6">
        <div className="mb-2 hidden justify-end sm:flex">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
          >
            Esc
          </button>
        </div>
        <AddTrackForm onClose={onClose} />
      </div>
    </div>
  );
}

export { DeleteTrackButton, PortfolioToolbar };
