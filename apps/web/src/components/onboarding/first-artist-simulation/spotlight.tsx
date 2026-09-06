"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// The spotlight crop (SK-310). A live screen renders whole inside the device,
// then the camera pushes in on one element and dims everything else, so a
// page with fifty things on it still reads as one idea. The same three marks
// play on every screen: an amber ring where Noya taps, one state change on
// the screen itself, and one green check that stamps the payoff.
//
// Nothing here knows about the screens. A cue names elements by selector,
// the camera measures them, and the CSS in globals.css (`.sk-reel-*`) moves
// them. Reduced motion settles straight on the final fit.

export interface SpotlightCue {
  /** Selectors whose union the camera centres on and the mask leaves lit. */
  focus?: readonly string[] | undefined;
  /** Where the fingertip ring blooms. */
  ring?: string | undefined;
  /** Narrows `ring` to the first match whose text passes, e.g. the Confirm button. */
  ringText?: RegExp | undefined;
  /** The element the green check sits on. */
  stamp?: string | undefined;
  /** An element covered by a node, e.g. the pressed button after it was pressed. */
  cover?: { selector: string; node: ReactNode } | undefined;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Fit {
  scale: number;
  tx: number;
  ty: number;
  spot: Rect | null;
  ring: { x: number; y: number } | null;
  stamp: { x: number; y: number } | null;
  cover: Rect | null;
}

const PAD = 14;
const MAX_SCALE = 1.3;
const MIN_SCALE = 0.9;

function pick(root: HTMLElement, selector: string, text?: RegExp): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(selector));
  return matches.find((node) => !text || text.test(node.textContent ?? "")) ?? null;
}

/** The closest ancestor inside the stage that actually scrolls. */
function scrollableAncestor(node: Element, stage: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current && current !== stage) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 4
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function union(rects: Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function Spotlight({
  cue,
  cueKey,
  settled,
  children,
}: {
  cue: SpotlightCue | null;
  /** Changes whenever the cue should be measured again (a new phase). */
  cueKey: string;
  /** Reduced motion: land on the final fit with no camera move. */
  settled: boolean;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const [fit, setFit] = useState<Fit | null>(null);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage || !cue) {
      scaleRef.current = 1;
      setFit(null);
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    if (viewportRect.width === 0 || viewportRect.height === 0) {
      // jsdom, or a frame that has not laid out yet: no camera, marks at rest.
      scaleRef.current = 1;
      setFit(null);
      return;
    }

    // Everything is measured in the stage's own, untransformed space, by
    // dividing out whatever scale the camera currently applies.
    const scale = scaleRef.current;
    const toStage = (rect: DOMRect, stageRect: DOMRect): Rect => ({
      x: (rect.left - stageRect.left) / scale,
      y: (rect.top - stageRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    });

    const focusNodes = (cue.focus ?? [])
      .map((selector) => pick(stage, selector))
      .filter((node): node is HTMLElement => node !== null);

    // The live screens scroll inside the device, and a transform cannot
    // reveal what a scroller clips, so the scroller moves first.
    const anchor = focusNodes[0];
    if (anchor) {
      const scroller = scrollableAncestor(anchor, stage);
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const delta =
          anchorRect.top + anchorRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
        scroller.scrollTop = Math.max(0, scroller.scrollTop + delta / scale);
      }
    }

    const stageRect = stage.getBoundingClientRect();
    const stageWidth = stageRect.width / scale;
    const stageHeight = stageRect.height / scale;
    const focusRect = union(focusNodes.map((node) => toStage(node.getBoundingClientRect(), stageRect)));

    let nextScale = 1;
    let tx = 0;
    let ty = 0;
    let spot: Rect | null = null;
    if (focusRect) {
      spot = {
        x: focusRect.x - PAD,
        y: focusRect.y - PAD,
        width: focusRect.width + PAD * 2,
        height: focusRect.height + PAD * 2,
      };
      nextScale = Math.min(
        MAX_SCALE,
        (viewportRect.width * 0.96) / spot.width,
        (viewportRect.height * 0.96) / spot.height,
      );
      nextScale = Math.max(MIN_SCALE, nextScale);
      const cx = spot.x + spot.width / 2;
      const cy = spot.y + spot.height / 2;
      tx = viewportRect.width / 2 - cx * nextScale;
      ty = viewportRect.height / 2 - cy * nextScale;
      // Keep the stage covering the viewport so no edge shows behind it.
      tx = Math.min(0, Math.max(viewportRect.width - stageWidth * nextScale, tx));
      ty = Math.min(0, Math.max(viewportRect.height - stageHeight * nextScale, ty));
    }

    const ringNode = cue.ring ? pick(stage, cue.ring, cue.ringText) : null;
    const ringRect = ringNode ? toStage(ringNode.getBoundingClientRect(), stageRect) : null;
    const stampNode = cue.stamp ? pick(stage, cue.stamp) : null;
    const stampRect = stampNode ? toStage(stampNode.getBoundingClientRect(), stageRect) : null;
    const coverNode = cue.cover ? pick(stage, cue.cover.selector) : null;
    const coverRect = coverNode ? toStage(coverNode.getBoundingClientRect(), stageRect) : null;

    scaleRef.current = nextScale;
    setFit({
      scale: nextScale,
      tx,
      ty,
      spot,
      ring: ringRect ? { x: ringRect.x + ringRect.width / 2, y: ringRect.y + ringRect.height / 2 } : null,
      stamp: stampRect ? { x: stampRect.x + stampRect.width, y: stampRect.y } : null,
      cover: coverRect,
    });
  }, [cue]);

  // Measure once the phase's screen has painted, and again a beat later in
  // case the live screen was still mounting its own content.
  useLayoutEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const late = setTimeout(measure, 120);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  }, [measure, cueKey]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const transform = fit
    ? `translate(${fit.tx.toFixed(1)}px, ${fit.ty.toFixed(1)}px) scale(${fit.scale.toFixed(3)})`
    : undefined;
  const stampPosition = fit?.stamp
    ? { left: fit.stamp.x - 28, top: fit.stamp.y - 28 }
    : { right: 12, top: 12 };

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-hidden">
      <div
        ref={stageRef}
        className={`sk-reel-stage absolute inset-0 origin-top-left ${settled ? "sk-reel-stage-settled" : ""}`}
        style={transform ? { transform } : undefined}
      >
        {children}
        {fit?.spot ? (
          <span
            aria-hidden
            className="sk-reel-mask"
            style={{
              left: fit.spot.x,
              top: fit.spot.y,
              width: fit.spot.width,
              height: fit.spot.height,
            }}
          />
        ) : null}
        {cue?.cover && fit?.cover ? (
          <div
            className="sk-reel-cover"
            style={{
              left: fit.cover.x,
              top: fit.cover.y,
              width: fit.cover.width,
              height: fit.cover.height,
            }}
          >
            {cue.cover.node}
          </div>
        ) : null}
        {cue?.ring && fit?.ring && !settled ? (
          <span
            key={cueKey}
            aria-hidden
            className="sk-reel-ring"
            style={{ left: fit.ring.x, top: fit.ring.y }}
          />
        ) : null}
        {cue?.stamp ? (
          <span
            key={cue.stamp}
            role="img"
            aria-label="Done"
            data-testid="reel-stamp"
            className="sk-reel-stamp"
            style={stampPosition}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </div>
    </div>
  );
}
