"use client";

import { useEffect, useRef, useState } from "react";

import { playerToggle } from "~/components/audio/persistent-player";
import { useToast } from "~/components/ui/toast";
import {
  addPointCommentAction,
  addRangeCommentAction,
} from "~/app/(app)/dashboard/projects/actions";

import {
  classifyDrag,
  formatRangeAnchor,
  msToPixels,
  pixelsToMs,
} from "./music-helpers";

// Story 06 — RangeCommentOverlay sits on top of the WaveformPlayer
// container and turns drag-on-waveform gestures into range comments.
//
// Event flow:
//   1. mousedown on the overlay → record startMs (pixelsToMs from
//      clientX vs containerRef boundingClientRect).
//   2. window mousemove → update endMs live so the band visual follows
//      the cursor (msToPixels back into pixel offsets for left + width).
//   3. window mouseup → classifyDrag(startMs, endMs, 200) decides:
//        a. point comment (< 200ms drag) → composer in point mode
//        b. range comment (>= 200ms drag) → composer in range mode
//      Auto-pause via playerToggle() so the producer can hear what
//      they're typing about without playback running over.
//   4. Submit → addRangeCommentAction (range) or addPointCommentAction
//      (point). The action revalidates the page so the new comment
//      appears in the comments-panel after the round-trip.
//
// Window-level listeners (not React handlers) are used for mousemove +
// mouseup because the cursor often leaves the waveform mid-drag — the
// overlay's onMouseMove would miss those events.
//
// Voice memos are deferred to v2 per PRD §11.6 — out of scope.

interface RangeCommentOverlayProps {
  versionId: string;
  projectId: string;
  /** Total duration of the audio in ms — used to convert px ↔ ms. */
  durationMs: number;
  /** Optional class to layer the overlay across the waveform container. */
  className?: string;
}

type DragState =
  | { phase: "idle" }
  | { phase: "dragging"; startMs: number; currentMs: number }
  | { phase: "composing-point"; timestampMs: number }
  | {
      phase: "composing-range";
      timestampMs: number;
      endTimestampMs: number;
    };

export function RangeCommentOverlay({
  versionId,
  projectId,
  durationMs,
  className,
}: RangeCommentOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();
  const [drag, setDrag] = useState<DragState>({ phase: "idle" });
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ─── Mousedown — start drag ───────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (drag.phase !== "idle") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = e.clientX - rect.left;
    const startMs = pixelsToMs(x, rect.width, durationMs);
    setDrag({ phase: "dragging", startMs, currentMs: startMs });
  }

  // ─── Window-level mousemove + mouseup while dragging ──────────────
  // Attached only during the dragging phase so we don't pay the cost
  // of always-on listeners. classifyDrag(200ms threshold) decides
  // point vs range on mouseup.
  useEffect(() => {
    if (drag.phase !== "dragging") return;
    const startMs = drag.startMs;

    function handleMove(e: MouseEvent) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const x = e.clientX - rect.left;
      const currentMs = pixelsToMs(x, rect.width, durationMs);
      setDrag({ phase: "dragging", startMs, currentMs });
    }
    function handleUp(e: MouseEvent) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        setDrag({ phase: "idle" });
        return;
      }
      const x = e.clientX - rect.left;
      const endMs = pixelsToMs(x, rect.width, durationMs);
      const classification = classifyDrag(startMs, endMs);
      // Auto-pause playback before opening the composer so the user
      // can read / type without audio running over them.
      playerToggle();
      if (classification.kind === "point") {
        setDrag({
          phase: "composing-point",
          timestampMs: classification.timestampMs,
        });
      } else {
        setDrag({
          phase: "composing-range",
          timestampMs: classification.timestampMs,
          endTimestampMs: classification.endTimestampMs,
        });
      }
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [drag, durationMs]);

  // ─── Cancel handler ───────────────────────────────────────────────
  function handleCancel() {
    setDrag({ phase: "idle" });
    setBody("");
  }

  // ─── Submit handler ───────────────────────────────────────────────
  async function handleSubmit() {
    if (drag.phase !== "composing-point" && drag.phase !== "composing-range") {
      return;
    }
    if (body.trim().length === 0) {
      toast("Please write a comment before submitting.", "info");
      return;
    }
    setSubmitting(true);
    try {
      const res =
        drag.phase === "composing-range"
          ? await addRangeCommentAction({
              projectId,
              versionId,
              body: body.trim(),
              timestampMs: drag.timestampMs,
              endTimestampMs: drag.endTimestampMs,
            })
          : await addPointCommentAction({
              projectId,
              versionId,
              body: body.trim(),
              timestampMs: drag.timestampMs,
            });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Comment posted.", "success");
      setDrag({ phase: "idle" });
      setBody("");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Couldn't post comment.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render: band overlay during drag, composer once dragged ─────
  // Derive the band's left + width from the current drag's start +
  // current ms values (or, when composing, from the persisted range
  // anchors). The band is purely decorative — pointer-events: none —
  // so it doesn't intercept new mousedowns underneath.
  const containerWidthSafe = (() => {
    return containerRef.current?.getBoundingClientRect().width ?? 0;
  })();

  let bandStyle: React.CSSProperties | null = null;
  if (drag.phase === "dragging" && containerWidthSafe > 0) {
    const startPx = msToPixels(
      Math.min(drag.startMs, drag.currentMs),
      containerWidthSafe,
      durationMs,
    );
    const endPx = msToPixels(
      Math.max(drag.startMs, drag.currentMs),
      containerWidthSafe,
      durationMs,
    );
    bandStyle = {
      left: `${String(startPx)}px`,
      width: `${String(Math.max(2, endPx - startPx))}px`,
    };
  } else if (
    drag.phase === "composing-range" &&
    containerWidthSafe > 0
  ) {
    const startPx = msToPixels(
      drag.timestampMs,
      containerWidthSafe,
      durationMs,
    );
    const endPx = msToPixels(
      drag.endTimestampMs,
      containerWidthSafe,
      durationMs,
    );
    bandStyle = {
      left: `${String(startPx)}px`,
      width: `${String(Math.max(2, endPx - startPx))}px`,
    };
  }

  const composerAnchor =
    drag.phase === "composing-range"
      ? formatRangeAnchor(drag.timestampMs, drag.endTimestampMs)
      : drag.phase === "composing-point"
        ? formatRangeAnchor(drag.timestampMs, null)
        : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      data-overlay-phase={drag.phase}
      className={[
        "absolute inset-0 cursor-crosshair select-none",
        className ?? "",
      ].join(" ")}
    >
      {/* Translucent band visual — fades in via the .sk-range-band CSS
          class (gated by prefers-reduced-motion in globals.css). */}
      {bandStyle ? (
        <div
          aria-hidden="true"
          style={bandStyle}
          className="sk-range-band pointer-events-none absolute inset-y-0 bg-[rgb(var(--brand-primary)/0.18)] border-l-2 border-r-2 border-[rgb(var(--brand-primary))]"
        />
      ) : null}

      {/* Composer — shown after mouseup. Auto-pauses playback (via
          playerToggle on the mouseup handler). */}
      {composerAnchor !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New comment composer"
          className="absolute bottom-2 left-2 right-2 z-20 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
              {composerAnchor}
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="sk-tap min-h-[44px] rounded-[var(--radius-sm)] px-2 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              aria-label="Cancel comment"
            >
              Cancel
            </button>
          </div>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
            placeholder="Write a comment…"
            rows={2}
            autoFocus
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1 text-sm text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={submitting || body.trim().length === 0}
              className="sk-tap min-h-[44px] rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-3 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-inverse))] hover:bg-[rgb(var(--brand-primary)/0.92)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
