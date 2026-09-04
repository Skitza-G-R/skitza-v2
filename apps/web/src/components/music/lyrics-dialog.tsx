"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";

import { formatRelativeTime } from "~/lib/time/relative";

import type { MusicL3LyricsActionResult } from "./song-page";

/**
 * SK-305. The song's words, in one editable sheet.
 *
 * Deliberately not built on SongManagementDialog: that one is a single-line
 * input used by eight callers, and widening it for a textarea would put every
 * one of them at risk for one new screen.
 *
 * Three rules shape everything below:
 *
 *   1. There is no read mode. A reader opens it and sees the words; Save stays
 *      disabled until the text actually changes, so reading can never save.
 *   2. Closing with unsaved changes shows an inline bar, never a second
 *      dialog — in this codebase a nested dialog renders underneath the
 *      overlay (SK-298), so the confirm would be invisible.
 *   3. A clash never clears what was typed. The other side's words go beside
 *      it, and the writer chooses.
 */
export const LYRICS_MAX_LENGTH = 8000;

// The counter is a warning, not a running tally. Showing it from character one
// would nag every producer who only ever writes a normal-length song.
const COUNTER_VISIBLE_FROM = LYRICS_MAX_LENGTH - 500;

export type LyricsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songTitle: string;
  lyrics: string | null;
  updatedAtIso: string | null;
  updatedBy: "producer" | "artist" | null;
  /** Which side is reading, so the footer can say "you" rather than a name. */
  viewerRole: "producer" | "artist";
  /** The other side's display name — the artist's, or the producer's. */
  otherPartyName: string;
  onSave: (input: {
    lyrics: string | null;
    expectedUpdatedAtIso: string | null;
  }) => Promise<MusicL3LyricsActionResult>;
  /** Fires only on a save that landed, so the page can refresh its badge. */
  onSaved: (saved: {
    lyrics: string | null;
    updatedAtIso: string;
    updatedBy: "producer" | "artist";
  }) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

type StaleNotice = {
  lyrics: string | null;
  updatedAtIso: string | null;
  updatedBy: "producer" | "artist" | null;
};

export function LyricsDialog({
  open,
  onOpenChange,
  songTitle,
  lyrics,
  updatedAtIso,
  updatedBy,
  viewerRole,
  otherPartyName,
  onSave,
  onSaved,
  returnFocusRef,
}: LyricsDialogProps) {
  const [text, setText] = useState(lyrics ?? "");
  // What the sheet said when this editor last synced with the server. It is
  // both the dirty check and, paired with `expected`, the clash guard.
  const [baseline, setBaseline] = useState(lyrics ?? "");
  const [expected, setExpected] = useState<string | null>(updatedAtIso);
  const [footer, setFooter] = useState<{ atIso: string | null; by: "producer" | "artist" | null }>({
    atIso: updatedAtIso,
    by: updatedBy,
  });
  const [stale, setStale] = useState<StaleNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [pending, setPending] = useState(false);

  // Reopening always starts from what the page currently holds. Carrying an
  // abandoned draft across open/close is the same confusion the upload modal
  // deliberately avoids.
  useEffect(() => {
    if (!open) return;
    setText(lyrics ?? "");
    setBaseline(lyrics ?? "");
    setExpected(updatedAtIso);
    setFooter({ atIso: updatedAtIso, by: updatedBy });
    setStale(null);
    setError(null);
    setConfirmingDiscard(false);
  }, [open, lyrics, updatedAtIso, updatedBy]);

  const dirty = text !== baseline;

  // "you" stays lowercase because it only ever appears mid-sentence
  // ("Updated by you"). The stale notice builds its own opening word.
  function writerName(role: "producer" | "artist" | null): string {
    if (role === null) return "someone";
    return role === viewerRole ? "you" : otherPartyName;
  }

  function requestClose() {
    // Nothing to lose, or the writer already said discard.
    if (!dirty || confirmingDiscard) {
      onOpenChange(false);
      return;
    }
    setConfirmingDiscard(true);
  }

  async function save(expectedOverride?: string | null) {
    if (pending) return;
    const expectedUpdatedAtIso = expectedOverride === undefined ? expected : expectedOverride;
    setPending(true);
    setError(null);
    try {
      const trimmed = text.trim();
      const result = await onSave({
        lyrics: trimmed === "" ? null : text,
        expectedUpdatedAtIso,
      });
      if (result.ok) {
        setBaseline(result.lyrics ?? "");
        setText(result.lyrics ?? "");
        setExpected(result.lyricsUpdatedAtIso);
        setFooter({ atIso: result.lyricsUpdatedAtIso, by: result.lyricsUpdatedBy });
        setStale(null);
        onSaved({
          lyrics: result.lyrics,
          updatedAtIso: result.lyricsUpdatedAtIso,
          updatedBy: result.lyricsUpdatedBy,
        });
        onOpenChange(false);
        return;
      }
      if (result.reason === "stale") {
        // The typed text stays exactly where it is. Only the guard moves on,
        // so "save mine anyway" is one click rather than a retype.
        setStale({
          lyrics: result.lyrics,
          updatedAtIso: result.lyricsUpdatedAtIso,
          updatedBy: result.lyricsUpdatedBy,
        });
        return;
      }
      setError(result.error);
    } catch {
      setError("The lyrics could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const footerLine =
    footer.atIso === null
      ? "Not written yet"
      : `Updated by ${writerName(footer.by)} · ${formatRelativeTime(new Date(footer.atIso))}`;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (!nextOpen) {
          requestClose();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          data-test="lyrics-dialog"
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                Lyrics
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug break-words text-[rgb(var(--fg-muted))]">
                <span dir="auto">{songTitle}</span>
                {" · everyone on this song can edit"}
              </DialogPrimitive.Description>
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={pending}
              onClick={requestClose}
              className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>

          {stale ? (
            <div
              role="alert"
              data-test="lyrics-stale-notice"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.1)] p-3.5"
            >
              <p className="flex items-start gap-2 text-[12.5px] leading-relaxed font-semibold text-[rgb(var(--fg-default))]">
                <AlertTriangle
                  size={15}
                  strokeWidth={2.2}
                  aria-hidden
                  className="mt-[0.15em] shrink-0"
                />
                <span>
                  {stale.updatedBy === viewerRole
                    ? "These lyrics were changed somewhere else while you were typing."
                    : `${stale.updatedBy === null ? "Someone" : otherPartyName} changed the lyrics ${stale.updatedAtIso ? formatRelativeTime(new Date(stale.updatedAtIso)) : "just now"} while you were typing.`}
                </span>
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                Your words are still in the box below. Nothing has been lost.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-test="lyrics-take-theirs"
                  disabled={pending}
                  onClick={() => {
                    setText(stale.lyrics ?? "");
                    setBaseline(stale.lyrics ?? "");
                    setExpected(stale.updatedAtIso);
                    setFooter({ atIso: stale.updatedAtIso, by: stale.updatedBy });
                    setStale(null);
                  }}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-3.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-50"
                >
                  See their version
                </button>
                <button
                  type="button"
                  data-test="lyrics-save-anyway"
                  disabled={pending}
                  onClick={() => {
                    // Adopt their stamp, then re-send the words already typed.
                    setExpected(stale.updatedAtIso);
                    setStale(null);
                    void save(stale.updatedAtIso);
                  }}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  Save mine anyway
                </button>
              </div>
            </div>
          ) : null}

          <label className="mt-4 block">
            <span className="sr-only">Lyrics for {songTitle}</span>
            <textarea
              // Hebrew is the common case here while the app itself is in
              // English, so the sheet decides its own direction from its first
              // strong character.
              dir="auto"
              value={text}
              disabled={pending}
              rows={12}
              maxLength={LYRICS_MAX_LENGTH}
              autoFocus
              placeholder="Type or paste the words of this song…"
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError(null);
                if (confirmingDiscard) setConfirmingDiscard(false);
              }}
              className="min-h-[220px] w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-[14.5px] leading-[1.8] text-[rgb(var(--fg-default))] transition-[border-color,box-shadow] outline-none placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary)/0.65)] focus:shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.12)] disabled:opacity-60"
            />
          </label>

          {text.length >= COUNTER_VISIBLE_FROM ? (
            <p
              role="status"
              className="mt-1.5 text-right font-mono text-[10px] text-[rgb(var(--fg-faint))] tabular-nums"
            >
              {String(text.length)}/{String(LYRICS_MAX_LENGTH)}
            </p>
          ) : null}

          {confirmingDiscard ? (
            <div
              role="alert"
              data-test="lyrics-discard-notice"
              className="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.07)] px-3.5 py-3"
            >
              <p className="flex-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-default))]">
                You have changes that are not saved yet.
              </p>
              <button
                type="button"
                data-test="lyrics-discard"
                onClick={() => {
                  onOpenChange(false);
                }}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.35)] px-3.5 text-[12.5px] font-semibold text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
              >
                Discard them
              </button>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.3)] bg-[rgb(var(--fg-danger)/0.08)] px-3.5 py-3 text-[12.5px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}

          <div className="sticky bottom-0 mt-5 flex flex-col-reverse gap-2 bg-[rgb(var(--bg-background))] pt-2 sm:flex-row sm:items-center">
            <p
              data-test="lyrics-updated-label"
              className="flex-1 text-[12px] text-[rgb(var(--fg-muted))]"
            >
              {footerLine}
            </p>
            <button
              type="button"
              onClick={requestClose}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-test="lyrics-save"
              // Disabled while unchanged is what lets this double as a reading
              // view: somebody who only opened it to read along cannot save.
              disabled={pending || !dirty}
              onClick={() => {
                void save();
              }}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-white disabled:opacity-45"
            >
              {pending ? "Saving…" : "Save lyrics"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Blank lines are part of a song's layout, so they count. */
export function lyricsLineCount(lyrics: string | null): number {
  if (lyrics === null) return 0;
  const trimmed = lyrics.trim();
  if (trimmed === "") return 0;
  return trimmed.split("\n").length;
}
