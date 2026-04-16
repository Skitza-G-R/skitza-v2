"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createTrack, deleteTrack } from "./actions";

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--fg-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary))]";

const labelClass =
  "block text-sm font-medium text-[rgb(var(--fg-primary))] mb-1";

interface AddTrackFormProps {
  // Renders inline below the "Add track" toggle. Expanded state lives in the
  // parent so the toggle button can flip between "Add track" and "Cancel".
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
      className="space-y-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-surface))] p-4"
    >
      <div>
        <label htmlFor="title" className={labelClass}>Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); }}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label htmlFor="artist" className={labelClass}>Artist (optional)</label>
        <input
          id="artist"
          type="text"
          value={artist}
          onChange={(e) => { setArtist(e.target.value); }}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="audioUrl" className={labelClass}>Audio URL</label>
        <input
          id="audioUrl"
          type="url"
          value={audioUrl}
          onChange={(e) => { setAudioUrl(e.target.value); }}
          className={inputClass}
          placeholder="https://…"
          required
        />
      </div>
      <div>
        <label htmlFor="artworkUrl" className={labelClass}>Artwork URL (optional)</label>
        <input
          id="artworkUrl"
          type="url"
          value={artworkUrl}
          onChange={(e) => { setArtworkUrl(e.target.value); }}
          className={inputClass}
          placeholder="https://…"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-[rgb(var(--fg-danger,239_68_68))]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-medium text-[rgb(var(--bg-base))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.9)] disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save track"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-4 py-2 text-sm font-medium text-[rgb(var(--fg-primary))] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface DeleteTrackButtonProps {
  trackId: string;
}

function DeleteTrackButton({ trackId }: DeleteTrackButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-danger,239_68_68))] disabled:opacity-50"
      >
        {pending ? "Deleting..." : "Delete"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-[rgb(var(--fg-danger,239_68_68))]">
          {error}
        </p>
      )}
    </div>
  );
}

export function AddTrackToggle() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-medium text-[rgb(var(--bg-base))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.9)]"
      >
        Add track
      </button>
    );
  }
  return <AddTrackForm onClose={() => { setOpen(false); }} />;
}

export { DeleteTrackButton };
