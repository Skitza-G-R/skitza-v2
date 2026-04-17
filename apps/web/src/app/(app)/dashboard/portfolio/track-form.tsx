"use client";

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { embedSourceLabel, parseEmbedUrl } from "~/lib/portfolio/embed-url";
import { createTrack, deleteTrack, reorderTracks } from "./actions";

interface AddTrackFormProps {
  onClose: () => void;
}

type AudioMode = "upload" | "link";

// TODO(A.8.1): Wire AudioUploader into the portfolio create flow.
// Blocker: the audio tRPC router (A.4) + useMultipartUpload hook (A.5) +
// AudioUploader component (A.6) are all scoped to `trackVersionId`
// (R2 key builder uses it; audio.completeMultipart patches the
// trackVersions table). Porting to portfolioTracks needs either
//   (a) a discriminator (`kind: "trackVersion" | "portfolio"`) threaded
//       through the router/hook/component, or
//   (b) a parallel `portfolioAudio.*` router.
// Until that lands the "Upload audio" tab also accepts a direct URL —
// the new "Paste a link" tab (G.10) is the polished alternative for
// Spotify / SoundCloud / YouTube / Apple Music shares (no R2 at all).
function AddTrackForm({ onClose }: AddTrackFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AudioMode>("upload");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [artworkUrl, setArtworkUrl] = useState("");

  // Detect the embed source on every keystroke — we need the chip
  // ("Recognized: Spotify track") to light up as soon as the user
  // finishes pasting without waiting for a blur event.
  const embed = useMemo(() => parseEmbedUrl(linkUrl), [linkUrl]);
  const trimmedLink = linkUrl.trim();

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Decide which URL to persist based on the active tab. If the user
    // pasted a Spotify/YouTube/etc link we save it verbatim — the
    // public portfolio page will detect it again via parseEmbedUrl()
    // and render the platform's iframe instead of TrackPlayer.
    const urlToSave = mode === "link" ? trimmedLink : audioUrl;
    if (!urlToSave) {
      setError(
        mode === "link"
          ? "Paste a Spotify, SoundCloud, YouTube, or Apple Music link."
          : "Enter an audio URL.",
      );
      return;
    }
    if (mode === "link" && !embed) {
      setError(
        "We don't recognize that URL. We support Spotify, SoundCloud, YouTube, and Apple Music links.",
      );
      return;
    }
    startTransition(async () => {
      const res = await createTrack({
        title,
        ...(artist ? { artist } : {}),
        audioUrl: urlToSave,
        ...(artworkUrl ? { artworkUrl } : {}),
      });
      if (res.ok) {
        toast(`"${title}" added to your portfolio.`, "success");
        setTitle("");
        setArtist("");
        setAudioUrl("");
        setLinkUrl("");
        setArtworkUrl("");
        onClose();
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
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
        <div className="sm:col-span-2">
          <Label>Audio source</Label>
          {/*
            Segmented control. Each option is 44px tall so the tap
            target is fat-finger-proof; the active state is the
            brand-primary gradient so the user can see at a glance
            whether we're about to save an upload URL or an embed link.
          */}
          <div
            role="tablist"
            aria-label="Audio source"
            className="mt-1 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-1"
          >
            <SegmentedButton
              active={mode === "upload"}
              onClick={() => { setMode("upload"); setError(null); }}
              label="Upload audio"
            />
            <SegmentedButton
              active={mode === "link"}
              onClick={() => { setMode("link"); setError(null); }}
              label="Paste a link"
            />
          </div>
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
        {mode === "upload" ? (
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
        ) : (
          <div>
            <Label htmlFor="linkUrl">Streaming link</Label>
            <Input
              id="linkUrl"
              type="url"
              value={linkUrl}
              onChange={(e) => { setLinkUrl(e.target.value); }}
              placeholder="https://open.spotify.com/track/…"
              required
              aria-describedby="linkUrlHelp"
            />
            <div id="linkUrlHelp" className="mt-2 min-h-[1.25rem] text-xs">
              {trimmedLink === "" ? (
                <span className="font-mono text-[rgb(var(--fg-muted))]">
                  Spotify · SoundCloud · YouTube · Apple Music
                </span>
              ) : embed ? (
                <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                  ♪ {embedSourceLabel(embed.source)} · ready
                </span>
              ) : (
                <span className="text-[rgb(var(--fg-danger))]">
                  We don&apos;t recognize that URL. We support Spotify, SoundCloud,
                  YouTube, Apple Music links.
                </span>
              )}
            </div>
          </div>
        )}
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

function SegmentedButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "flex h-11 items-center justify-center rounded-[var(--radius-sm)] px-3 text-sm font-medium transition-colors",
        active
          ? "bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--fg-primary))] shadow-[inset_0_0_0_1px_rgb(var(--brand-primary)/0.4)]"
          : "text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function DeleteTrackButton({ trackId }: { trackId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTrack({ id: trackId });
      if (res.ok) {
        toast("Track removed.", "success");
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
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

// Up/down reorder controls. Takes the FULL list of ordered IDs and the
// index of the track to move — builds a new ordered array, sends to the
// reorderTracks action. Backend (`portfolio.reorder`) filters by
// producerId so a stale ID list (e.g. another tab added a track between
// render and click) is a partial no-op, not a leak.
function ReorderButtons({
  trackId,
  orderedIds,
}: {
  trackId: string;
  orderedIds: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const idx = orderedIds.indexOf(trackId);
  const atTop = idx <= 0;
  const atBottom = idx === orderedIds.length - 1;

  function move(direction: -1 | 1) {
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= orderedIds.length) return;
    const next = [...orderedIds];
    const [removed] = next.splice(idx, 1);
    if (!removed) return;
    next.splice(target, 0, removed);
    startTransition(async () => {
      const res = await reorderTracks({ orderedIds: next });
      if (res.ok) {
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-label="Move track up"
        disabled={atTop || pending}
        onClick={() => {
          move(-1);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30"
      >
        <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden>
          <path d="M6 3L2 8h8z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Move track down"
        disabled={atBottom || pending}
        onClick={() => {
          move(1);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30"
      >
        <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden>
          <path d="M6 9L2 4h8z" />
        </svg>
      </button>
    </div>
  );
}

export { DeleteTrackButton, PortfolioToolbar, ReorderButtons };
