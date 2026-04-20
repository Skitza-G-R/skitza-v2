"use client";

import { useEffect, useState } from "react";

// Tiny status chip that any autosaving form cell can drop next to the
// field. Three states:
//   - saving  → muted "Saving…" with a pulsing dot
//   - saved   → green "Saved ✓" flashed for 2s, then fades to invisible
//   - idle    → invisible (no chip rendered)
//
// The producer gets immediate reassurance without a toast popping into
// the corner every time they flip a switch — inline proximity to the
// field doing the work reads far less noisy.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Pure transition: given the previous chip status and a new saving/
 * error signal, return the next chip status. Exported so the hook's
 * logic can be unit-tested without jsdom. Rules:
 *   - `error` signal always wins → "error".
 *   - `saving === true` → "saving".
 *   - `saving === false` and we were "saving" → flash "saved".
 *   - otherwise the previous status is kept (callers reset to "idle"
 *     via the 2s timer in `useSaveStatus`).
 */
export function nextSaveStatus(
  prev: SaveStatus,
  signal: { saving: boolean; error?: string | null },
): SaveStatus {
  if (signal.error) return "error";
  if (signal.saving) return "saving";
  if (prev === "saving") return "saved";
  return prev;
}

// Hook that derives the chip's visible state from the underlying
// "saving"/"saved"/"error" signal, transitioning "saved" back to
// "idle" 2 s after it lands. Callers only need to flip `saving ↔ saved
// ↔ error`; the fade is owned here.
export function useSaveStatus({
  saving,
  error,
}: {
  saving: boolean;
  error?: string | null;
}): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    setStatus((prev) => nextSaveStatus(prev, { saving, error: error ?? null }));
  }, [saving, error]);

  useEffect(() => {
    if (status !== "saved") return;
    const t = window.setTimeout(() => {
      setStatus("idle");
    }, 2000);
    return () => {
      window.clearTimeout(t);
    };
  }, [status]);

  return status;
}

export function SaveIndicator({
  status,
  errorMessage,
  className = "",
}: {
  status: SaveStatus;
  errorMessage?: string;
  className?: string;
}) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <span
        role="status"
        aria-live="polite"
        className={[
          "inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[rgb(var(--fg-muted))]"
        />
        <span>Saving…</span>
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span
        role="status"
        aria-live="polite"
        // The `sk-pop` primitive (defined in globals.css) gives the chip
        // a gentle 180ms ease-out scale+opacity entrance — same motion
        // token the coachmark tooltip uses. Respects
        // prefers-reduced-motion (sk-pop is motion-safe gated).
        className={[
          "sk-pop inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-success,16_185_129))]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <svg aria-hidden width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2l2.3 2.3L9.5 3.5" />
        </svg>
        <span>Saved</span>
      </span>
    );
  }

  // error
  return (
    <span
      role="alert"
      aria-live="polite"
      className={[
        "inline-flex items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-danger))]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-danger))]" />
      <span>{errorMessage ?? "Couldn't save"}</span>
    </span>
  );
}
