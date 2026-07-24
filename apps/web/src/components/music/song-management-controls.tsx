"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Archive,
  ArchiveRestore,
  BadgeCheck,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  TriangleAlert,
  UserRoundPen,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

export type SongManagementResult = { ok: true } | { ok: false; error: string };

export type RenameSongAction = (input: {
  projectId: string;
  trackId: string;
  title: string;
}) => Promise<SongManagementResult>;

export type EditSongArtistAction = (input: {
  projectId: string;
  trackId: string;
  artist: string | null;
}) => Promise<SongManagementResult>;

export type SetSongArchivedAction = (input: {
  projectId: string;
  trackId: string;
  archived: boolean;
}) => Promise<SongManagementResult>;

export type MarkSongReleasedAction = (input: {
  projectId: string;
  trackId: string;
}) => Promise<SongManagementResult>;

type ManagementMode = "menu" | "rename" | "artist" | "archive" | "release";

export function SongManagementControls({
  projectId,
  trackId,
  title,
  artist,
  archived,
  releasedAtIso,
  renameSong,
  editArtist,
  setArchived,
  markReleased,
  overlay = false,
}: {
  projectId: string;
  trackId: string;
  title: string;
  artist: string | null;
  archived: boolean;
  releasedAtIso?: string | null;
  renameSong: RenameSongAction;
  editArtist: EditSongArtistAction;
  setArchived: SetSongArchivedAction;
  markReleased?: MarkSongReleasedAction;
  /** Gives cover-art triggers enough contrast without changing semantics. */
  overlay?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ManagementMode>("menu");
  const [titleDraft, setTitleDraft] = useState(title);
  const [artistDraft, setArtistDraft] = useState(artist ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const released = releasedAtIso != null;

  const reset = () => {
    setMode("menu");
    setTitleDraft(title);
    setArtistDraft(artist ?? "");
    setError(null);
  };

  const close = () => {
    if (pending) return;
    setOpen(false);
    reset();
  };

  const showMode = (nextMode: Exclude<ManagementMode, "menu">) => {
    setError(null);
    setTitleDraft(title);
    setArtistDraft(artist ?? "");
    setMode(nextMode);
  };

  const runAction = async (action: () => Promise<SongManagementResult>) => {
    if (pending) return;
    if (!online) {
      setError("Reconnect to update this song.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("The song could not be updated. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const submitRename = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setError("Enter a song title.");
      return;
    }
    await runAction(() => renameSong({ projectId, trackId, title: nextTitle }));
  };

  const submitArtist = async () => {
    const nextArtist = artistDraft.trim();
    await runAction(() =>
      editArtist({ projectId, trackId, artist: nextArtist.length > 0 ? nextArtist : null }),
    );
  };

  const submitArchive = async () => {
    await runAction(() => setArchived({ projectId, trackId, archived: !archived }));
  };

  const submitRelease = async () => {
    if (!markReleased || released) return;
    await runAction(() => markReleased({ projectId, trackId }));
  };

  const heading =
    mode === "rename"
      ? "Rename song"
      : mode === "artist"
        ? "Edit artist credit"
        : mode === "release"
          ? "Mark as Released"
          : mode === "archive"
            ? archived
              ? "Restore song"
              : "Archive song"
            : `Manage ${title}`;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          reset();
          setOpen(true);
        } else {
          close();
        }
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${title}`}
          className={[
            "sk-press relative z-30 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:outline-none",
            overlay
              ? "bg-[rgb(17_16_9)/0.46] text-white backdrop-blur-sm focus-visible:ring-offset-transparent"
              : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-offset-[rgb(var(--bg-background))]",
          ].join(" ")}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)] focus:outline-none">
          <div className="flex items-start gap-3 pr-9">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {heading}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                {mode === "menu"
                  ? "Change the song details or its working status."
                  : mode === "rename"
                    ? "This changes the song title everywhere it appears."
                    : mode === "artist"
                      ? "Use the artist name exactly as it should appear in Music."
                      : mode === "release"
                        ? "Released is a one-way status change for this song."
                        : archived
                          ? "The song returns to active work, subject to the project and purchase status."
                          : "The song stays available to listen to, but new work pauses until it is restored."}
              </DialogPrimitive.Description>
            </div>
          </div>

          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label="Close song actions"
              disabled={pending}
              className="sk-press absolute top-2.5 right-2.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] disabled:opacity-45"
            >
              <X size={17} strokeWidth={2.2} aria-hidden />
            </button>
          </DialogPrimitive.Close>

          {mode === "menu" ? (
            <div className="mt-5 grid gap-2" role="group" aria-label="Song actions">
              <ManagementChoice
                label="Rename song"
                description="Update the title without changing its versions."
                icon={<Pencil size={18} aria-hidden />}
                onClick={() => {
                  showMode("rename");
                }}
              />
              <ManagementChoice
                label="Edit artist credit"
                description="Change the artist name shown with this song."
                icon={<UserRoundPen size={18} aria-hidden />}
                onClick={() => {
                  showMode("artist");
                }}
              />
              <ManagementChoice
                label={archived ? "Restore song" : "Archive song"}
                description={
                  archived
                    ? "Allow new work on this song again."
                    : "Pause new uploads and comments."
                }
                icon={
                  archived ? (
                    <ArchiveRestore size={18} aria-hidden />
                  ) : (
                    <Archive size={18} aria-hidden />
                  )
                }
                onClick={() => {
                  showMode("archive");
                }}
              />
              {released ? (
                <div
                  role="status"
                  className="flex min-h-11 items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.24)] bg-[rgb(var(--fg-success)/0.08)] px-3 py-2.5"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success))]">
                    <BadgeCheck size={18} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold text-[rgb(var(--fg-default))]">
                      Released
                    </span>
                    <span className="block text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
                      This status cannot be reversed.
                    </span>
                  </span>
                </div>
              ) : markReleased ? (
                <ManagementChoice
                  label="Mark as Released"
                  description="Finish the song and unlock released-audio cleanup."
                  icon={<BadgeCheck size={18} aria-hidden />}
                  onClick={() => {
                    showMode("release");
                  }}
                />
              ) : null}
            </div>
          ) : mode === "rename" ? (
            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
              }}
            >
              <label className="block text-[12px] font-bold text-[rgb(var(--fg-default))]">
                Song title
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={120}
                  disabled={pending}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    setError(null);
                  }}
                  className="mt-2 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] font-medium text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary-dark))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.18)] disabled:opacity-55"
                />
              </label>
              <DialogActions
                pending={pending}
                error={error}
                actionLabel="Save title"
                pendingLabel="Saving…"
                onBack={() => {
                  setMode("menu");
                  setError(null);
                }}
              />
            </form>
          ) : mode === "artist" ? (
            <form
              className="mt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void submitArtist();
              }}
            >
              <label className="block text-[12px] font-bold text-[rgb(var(--fg-default))]">
                Artist credit
                <input
                  autoFocus
                  value={artistDraft}
                  maxLength={120}
                  disabled={pending}
                  placeholder="No artist credit"
                  onChange={(event) => {
                    setArtistDraft(event.target.value);
                    setError(null);
                  }}
                  className="mt-2 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] font-medium text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary-dark))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.18)] disabled:opacity-55"
                />
              </label>
              <DialogActions
                pending={pending}
                error={error}
                actionLabel="Save artist"
                pendingLabel="Saving…"
                onBack={() => {
                  setMode("menu");
                  setError(null);
                }}
              />
            </form>
          ) : mode === "archive" ? (
            <div className="mt-5">
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                <p className="text-[12px] font-bold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
                  {archived ? "After restoring" : "After archiving"}
                </p>
                <ul className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  {archived ? (
                    <>
                      <li>
                        New uploads and comments can resume when the project and purchase allow
                        them.
                      </li>
                      <li>
                        The song’s versions, playback, and history stay exactly where they are.
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        The song stays listenable and keeps its version, comment, and public-link
                        history.
                      </li>
                      <li>New uploads and comments are blocked until the song is restored.</li>
                      <li>The project and its other songs are not archived.</li>
                    </>
                  )}
                </ul>
              </div>
              {error ? (
                <p
                  role="alert"
                  className="mt-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode("menu");
                    setError(null);
                  }}
                  disabled={pending}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-45"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitArchive();
                  }}
                  disabled={pending}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-white disabled:opacity-45"
                >
                  {pending
                    ? archived
                      ? "Restoring…"
                      : "Archiving…"
                    : archived
                      ? "Restore song"
                      : "Archive song"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.24)] bg-[rgb(var(--fg-danger)/0.07)] p-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-danger))]">
                    <TriangleAlert size={20} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
                      One-way change
                    </p>
                    <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                      <li>The song will be marked Released and cannot be marked unreleased.</li>
                      <li>
                        Released songs allow permanent deletion of current, final, or last stored
                        audio after a separate strong warning.
                      </li>
                      <li>Playback, version names, dates, and comments stay unchanged now.</li>
                    </ul>
                  </div>
                </div>
              </div>
              {error ? (
                <p
                  role="alert"
                  className="mt-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode("menu");
                    setError(null);
                  }}
                  disabled={pending}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-45"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void submitRelease();
                  }}
                  disabled={pending || released || !markReleased}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.38)] disabled:opacity-45"
                >
                  {pending ? "Marking Released…" : "Mark as Released"}
                </button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ManagementChoice({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sk-press flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-left hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-default))]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-[rgb(var(--fg-default))]">{label}</span>
        <span className="block text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
          {description}
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-[rgb(var(--fg-faint))]" aria-hidden />
    </button>
  );
}

function DialogActions({
  pending,
  error,
  actionLabel,
  pendingLabel,
  onBack,
}: {
  pending: boolean;
  error: string | null;
  actionLabel: string;
  pendingLabel: string;
  onBack: () => void;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-45"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={pending}
          className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-white disabled:opacity-45"
        >
          {pending ? pendingLabel : actionLabel}
        </button>
      </div>
    </>
  );
}
