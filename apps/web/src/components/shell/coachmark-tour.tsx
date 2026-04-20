"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CLOSED,
  STEPS,
  back as stepBack,
  currentStep,
  hasSeenTour,
  isClosed,
  markTourSeen,
  next as stepNext,
  skip as stepSkip,
  start as stepStart,
  type TourState,
  type TourStep,
} from "./coachmark-tour-steps";

// Producer first-run guided tour. Lightweight, zero-dep: a React
// portal onto document.body that renders a dim backdrop with a
// box-shadow spotlight cutout over the target element, plus a
// tooltip card pinned to the side with the most free space.
//
// State machine lives in `./coachmark-tour-steps` so unit tests can
// cover the transitions without jsdom. This component is the runtime:
// it resolves `data-tour-id` targets, listens for keyboard nav, and
// coordinates the localStorage seen-flag so returning producers don't
// see the tour again.
//
// The tour kicks off automatically on mount when the localStorage
// flag is unset (first-run). It also listens for a
// `skitza:replay-tour` window event — dispatched by the "Replay
// onboarding tour" button in Setup → Account — to restart on demand.

const SPOTLIGHT_PADDING = 8;
const SPOTLIGHT_RADIUS = 12;
const TOOLTIP_OFFSET = 14;
const TOOLTIP_WIDTH = 320;
const TOOLTIP_MIN_MARGIN = 16;

type Rect = { top: number; left: number; width: number; height: number };

// Computed tooltip placement relative to the spotlight. We include the
// side so the visual arrow/edge can mirror in CSS later if we want to
// — right now we don't render an arrow, but the side is still used
// when falling back to a centered card (no target resolved).
type Placement = {
  top: number;
  left: number;
  side: "top" | "bottom" | "left" | "right" | "center";
};

function getReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function resolveTarget(id: string | undefined): HTMLElement | null {
  if (!id) return null;
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-tour-id="${id}"]`);
  return el;
}

function readRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// Pick the side with the most room, subject to a minimum of
// TOOLTIP_WIDTH + 32 px. Falls back to "bottom" if everything is tight.
function placeTooltip(
  rect: Rect | null,
  preferred: TourStep["side"],
  vw: number,
  vh: number,
): Placement {
  if (!rect) {
    return {
      top: Math.max(TOOLTIP_MIN_MARGIN, vh / 2 - 120),
      left: Math.max(TOOLTIP_MIN_MARGIN, vw / 2 - TOOLTIP_WIDTH / 2),
      side: "center",
    };
  }
  const spaceTop = rect.top;
  const spaceBottom = vh - (rect.top + rect.height);
  const spaceLeft = rect.left;
  const spaceRight = vw - (rect.left + rect.width);

  // Resolve preferred → concrete side if there's room; otherwise pick the largest.
  type SideOption = { side: "top" | "bottom" | "left" | "right"; space: number };
  const order: SideOption[] = [
    { side: "bottom", space: spaceBottom },
    { side: "top", space: spaceTop },
    { side: "right", space: spaceRight },
    { side: "left", space: spaceLeft },
  ];
  order.sort((a, b) => b.space - a.space);

  const pref = preferred && preferred !== "auto" ? preferred : null;
  const prefFit = order.find((o) => o.side === pref && o.space >= 180);
  const chosen: SideOption = prefFit ?? order[0] ?? { side: "bottom", space: spaceBottom };
  const side = chosen.side;

  let top = 0;
  let left = 0;
  if (side === "bottom") {
    top = rect.top + rect.height + TOOLTIP_OFFSET;
    left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  } else if (side === "top") {
    top = rect.top - TOOLTIP_OFFSET - 200;
    left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
  } else if (side === "right") {
    top = rect.top + rect.height / 2 - 90;
    left = rect.left + rect.width + TOOLTIP_OFFSET;
  } else {
    top = rect.top + rect.height / 2 - 90;
    left = rect.left - TOOLTIP_OFFSET - TOOLTIP_WIDTH;
  }

  // Clamp to viewport with a small margin so the card never clips.
  left = Math.min(vw - TOOLTIP_WIDTH - TOOLTIP_MIN_MARGIN, Math.max(TOOLTIP_MIN_MARGIN, left));
  top = Math.min(vh - 160 - TOOLTIP_MIN_MARGIN, Math.max(TOOLTIP_MIN_MARGIN, top));
  return { top, left, side };
}

export function CoachmarkTour({
  autoStart = true,
}: {
  /**
   * When false, the tour won't auto-open on first mount. Used by tests.
   * In production we always leave this true — the localStorage flag
   * gates actual visibility.
   */
  autoStart?: boolean;
}) {
  const [state, setState] = useState<TourState>(CLOSED);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [mounted, setMounted] = useState(false);
  const reducedMotion = useRef(false);

  const step = currentStep(state);
  const running = !isClosed(state);

  const onSkip = useCallback(() => {
    markTourSeen(typeof window !== "undefined" ? window.localStorage : null);
    setState(stepSkip());
  }, []);

  const onNext = useCallback(() => {
    setState((prev) => {
      const next = stepNext(prev);
      if (isClosed(next)) {
        markTourSeen(typeof window !== "undefined" ? window.localStorage : null);
      }
      return next;
    });
  }, []);

  const onBack = useCallback(() => {
    setState((prev) => stepBack(prev));
  }, []);

  // Mount + first-run autostart. We defer the "should I show?" check
  // until after hydration to keep SSR markup identical for every user.
  useEffect(() => {
    setMounted(true);
    reducedMotion.current = getReducedMotion();
    if (!autoStart) return;
    const seen = hasSeenTour(typeof window !== "undefined" ? window.localStorage : null);
    if (!seen) {
      setState(stepStart());
    }
  }, [autoStart]);

  // Replay trigger — wired to the Setup → Account button. Clears the
  // flag and kicks a fresh run.
  useEffect(() => {
    function onReplay() {
      setState(stepStart());
    }
    window.addEventListener("skitza:replay-tour", onReplay);
    return () => {
      window.removeEventListener("skitza:replay-tour", onReplay);
    };
  }, []);

  // Keyboard: Esc = skip, → = next, ← = back. We intentionally hijack
  // the arrow keys only while the tour is visible, so general page
  // navigation isn't affected.
  useEffect(() => {
    if (!running) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [running, onSkip, onNext, onBack]);

  // Resolve the spotlight target whenever the step changes. If the
  // target is missing on this page (e.g. a user replayed the tour
  // from a deep route), we silently skip to the next step so the
  // tour never gets stuck on an unresolvable element.
  useLayoutEffect(() => {
    if (!running || !step) return;
    if (!step.targetId) {
      setRect(null);
      return;
    }
    const el = resolveTarget(step.targetId);
    if (!el) {
      // Advance on the next tick so we don't setState during render.
      const t = window.setTimeout(() => {
        onNext();
      }, 0);
      return () => {
        window.clearTimeout(t);
      };
    }
    setRect(readRect(el));
  }, [running, step, onNext]);

  // Keep the rect + viewport in sync with resize/scroll so the
  // spotlight tracks the element if the user scrolls during the tour.
  useEffect(() => {
    if (!running) return;
    function sync() {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      if (step?.targetId) {
        const el = resolveTarget(step.targetId);
        if (el) setRect(readRect(el));
      }
    }
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [running, step]);

  // Scroll the target into view when a new spotlighted step opens.
  // Respects prefers-reduced-motion.
  useEffect(() => {
    if (!running || !step?.targetId) return;
    const el = resolveTarget(step.targetId);
    if (!el) return;
    try {
      el.scrollIntoView({
        behavior: reducedMotion.current ? "auto" : "smooth",
        block: "center",
        inline: "center",
      });
    } catch {
      // Some browsers (Safari on old iOS) throw on the options object —
      // fall back to the boolean form.
      el.scrollIntoView();
    }
  }, [running, step]);

  const placement = useMemo(() => {
    if (!step) {
      return { top: 0, left: 0, side: "center" as const };
    }
    const vw = viewport.w || (typeof window !== "undefined" ? window.innerWidth : 1200);
    const vh = viewport.h || (typeof window !== "undefined" ? window.innerHeight : 800);
    return placeTooltip(step.targetId ? rect : null, step.side, vw, vh);
  }, [step, rect, viewport]);

  if (!mounted || !running || !step) return null;
  if (typeof document === "undefined") return null;

  const totalSteps = STEPS.length;
  const currentNumber = state.index + 1;
  const isFirst = state.index === 0;
  const isLast = state.index === totalSteps - 1;

  const spotlightStyle: React.CSSProperties | null = rect
    ? {
        position: "fixed",
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
        borderRadius: SPOTLIGHT_RADIUS,
        pointerEvents: "none",
        // The dim is painted by the spotlight's box-shadow so the
        // backdrop and cutout are a single layer. 9999px > any screen.
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
        outline: "2px solid rgb(var(--brand-primary))",
        outlineOffset: 0,
        transition: reducedMotion.current
          ? undefined
          : "top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease",
        zIndex: 60,
      }
    : null;

  // Centered-modal case (no spotlight target). We paint a full-screen
  // dim ourselves because we don't have a spotlight layer to carry it.
  const fullDimStyle: React.CSSProperties | null =
    !rect
      ? {
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.62)",
          zIndex: 60,
          pointerEvents: "none",
        }
      : null;

  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    top: placement.top,
    left: placement.left,
    width: TOOLTIP_WIDTH,
    zIndex: 61,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coachmark-title"
      aria-describedby="coachmark-body"
    >
      {/* Click-to-skip backdrop: captures clicks outside the spotlight
          and the tooltip. We put it under the spotlight and tooltip
          (lower z-index) so they remain interactive. */}
      <button
        type="button"
        aria-label="Skip tour"
        onClick={onSkip}
        className="fixed inset-0 z-[59] cursor-default bg-transparent"
      />
      {spotlightStyle ? <div aria-hidden style={spotlightStyle} /> : null}
      {fullDimStyle ? <div aria-hidden style={fullDimStyle} /> : null}
      <div
        style={tooltipStyle}
        className={[
          "rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)]",
          reducedMotion.current ? "" : "sk-pop",
        ].join(" ")}
        data-tour-side={placement.side}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Step {currentNumber} of {totalSteps}
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            Skip
          </button>
        </div>
        <h2
          id="coachmark-title"
          className="mt-2 font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          {step.title}
        </h2>
        <p
          id="coachmark-body"
          className="mt-2 text-sm leading-6 text-[rgb(var(--fg-secondary))]"
        >
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={isFirst}
            className="text-xs font-medium text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2">
            {STEPS.map((_, idx) => (
              <span
                key={STEPS[idx]?.id ?? idx}
                aria-hidden
                className={[
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  idx === state.index
                    ? "bg-[rgb(var(--brand-primary))]"
                    : idx < state.index
                      ? "bg-[rgb(var(--fg-muted))]"
                      : "bg-[rgb(var(--border-subtle))]",
                ].join(" ")}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onNext}
            className="sk-lift inline-flex h-8 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-xs font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
          >
            {step.nextLabel ?? (isLast ? "Finish" : "Next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
