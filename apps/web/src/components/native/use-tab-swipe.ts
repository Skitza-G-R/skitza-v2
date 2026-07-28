"use client";

import { useEffect, useRef, type MouseEventHandler, type PointerEventHandler } from "react";

const DEFAULT_MIN_DISTANCE = 56;
const DEFAULT_MIN_FLICK_DISTANCE = 24;
const DEFAULT_MIN_VELOCITY = 0.55;
const HORIZONTAL_INTENT_RATIO = 1.25;
const DRAG_INTENT_DISTANCE = 12;
const DRAG_INTENT_RATIO = 1.1;
const DIRECT_DRAG_DISTANCE = 64;
const MAX_DRAG_OFFSET = 132;
const DRAG_OVERFLOW_RESISTANCE = 0.5;
const MAX_BOUNDARY_OFFSET = 24;
const BOUNDARY_RESISTANCE = 0.2;
const SETTLE_CLEANUP_MS = 190;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SWIPE_OFFSET_PROPERTY = "--sk-tab-swipe-x";
const IGNORE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "audio",
  "video",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="slider"]',
  "[data-tab-swipe-ignore]",
].join(",");

interface ResolveTabSwipeTargetInput {
  activeIndex: number;
  itemCount: number;
  deltaX: number;
  deltaY: number;
  minDistance?: number;
}

interface ResolveTabSwipeReleaseTargetInput extends ResolveTabSwipeTargetInput {
  velocityX: number;
  minFlickDistance?: number;
  minVelocity?: number;
}

interface ResolveTabSwipeDragOffsetInput {
  activeIndex: number;
  itemCount: number;
  deltaX: number;
}

/**
 * Resolves a physical horizontal swipe to an adjacent tab.
 *
 * Left advances and right goes back. A gesture must be both long enough
 * and clearly more horizontal than vertical; boundaries never wrap.
 */
export function resolveTabSwipeTargetIndex({
  activeIndex,
  itemCount,
  deltaX,
  deltaY,
  minDistance = DEFAULT_MIN_DISTANCE,
}: ResolveTabSwipeTargetInput): number | null {
  if (
    !Number.isInteger(activeIndex) ||
    !Number.isInteger(itemCount) ||
    activeIndex < 0 ||
    activeIndex >= itemCount ||
    itemCount < 2
  ) {
    return null;
  }

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (
    horizontalDistance < minDistance ||
    horizontalDistance <= verticalDistance * HORIZONTAL_INTENT_RATIO
  ) {
    return null;
  }

  const targetIndex = activeIndex + (deltaX < 0 ? 1 : -1);
  return targetIndex >= 0 && targetIndex < itemCount ? targetIndex : null;
}

/**
 * Resolves release intent using either deliberate travel or a short flick.
 * Velocity never overrides an opposite displacement, which keeps a reversed
 * gesture from unexpectedly changing tabs.
 */
export function resolveTabSwipeReleaseTargetIndex({
  activeIndex,
  itemCount,
  deltaX,
  deltaY,
  velocityX,
  minDistance = DEFAULT_MIN_DISTANCE,
  minFlickDistance = DEFAULT_MIN_FLICK_DISTANCE,
  minVelocity = DEFAULT_MIN_VELOCITY,
}: ResolveTabSwipeReleaseTargetInput): number | null {
  const distanceTarget = resolveTabSwipeTargetIndex({
    activeIndex,
    itemCount,
    deltaX,
    deltaY,
    minDistance,
  });
  if (distanceTarget !== null) return distanceTarget;

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  const velocityMatchesDisplacement =
    deltaX !== 0 && velocityX !== 0 && Math.sign(deltaX) === Math.sign(velocityX);
  if (
    horizontalDistance < minFlickDistance ||
    horizontalDistance <= verticalDistance * HORIZONTAL_INTENT_RATIO ||
    Math.abs(velocityX) < minVelocity ||
    !velocityMatchesDisplacement
  ) {
    return null;
  }

  const targetIndex = activeIndex + (velocityX < 0 ? 1 : -1);
  return targetIndex >= 0 && targetIndex < itemCount ? targetIndex : null;
}

/**
 * Keeps valid drags visibly attached to the finger without exposing a blank
 * full-width panel. Outward boundary movement uses a tighter rubber band.
 */
export function resolveTabSwipeDragOffset({
  activeIndex,
  itemCount,
  deltaX,
}: ResolveTabSwipeDragOffsetInput): number {
  if (
    !Number.isInteger(activeIndex) ||
    !Number.isInteger(itemCount) ||
    activeIndex < 0 ||
    activeIndex >= itemCount ||
    itemCount < 2 ||
    !Number.isFinite(deltaX)
  ) {
    return 0;
  }

  const hasNeighbor = deltaX < 0 ? activeIndex < itemCount - 1 : activeIndex > 0;
  if (!hasNeighbor) {
    const resisted = deltaX * BOUNDARY_RESISTANCE;
    return Math.max(-MAX_BOUNDARY_OFFSET, Math.min(MAX_BOUNDARY_OFFSET, resisted));
  }

  const direction = Math.sign(deltaX);
  const distance = Math.abs(deltaX);
  const trackedDistance =
    distance <= DIRECT_DRAG_DISTANCE
      ? distance
      : Math.min(
          MAX_DRAG_OFFSET,
          DIRECT_DRAG_DISTANCE +
            (distance - DIRECT_DRAG_DISTANCE) * DRAG_OVERFLOW_RESISTANCE,
        );
  return direction * trackedDistance;
}

function hasNestedSwipeSurface(target: Element, surface: Element): boolean {
  const closestSurface = target.closest("[data-tab-swipe-surface]");
  return closestSurface !== null && closestSurface !== surface;
}

function hasIgnoredControl(target: Element, surface: Element): boolean {
  const ignored = target.closest(IGNORE_SELECTOR);
  return ignored !== null && surface.contains(ignored);
}

function hasHorizontalScroller(target: Element, surface: Element): boolean {
  let current: Element | null = target;
  while (current && current !== surface) {
    if (current instanceof HTMLElement && current.scrollWidth > current.clientWidth + 1) {
      const overflowX = window.getComputedStyle(current).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    current = current.parentElement;
  }
  return false;
}

type TabSwipeIntent = "pending" | "horizontal" | "vertical";

function resolveTabSwipeIntent(deltaX: number, deltaY: number): TabSwipeIntent {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (horizontalDistance <= DRAG_INTENT_DISTANCE && verticalDistance <= DRAG_INTENT_DISTANCE) {
    return "pending";
  }
  if (horizontalDistance > verticalDistance * DRAG_INTENT_RATIO) {
    return "horizontal";
  }
  if (verticalDistance > horizontalDistance * DRAG_INTENT_RATIO) {
    return "vertical";
  }
  return "pending";
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getVisualTarget(surface: HTMLDivElement): HTMLElement {
  const panel = Array.from(surface.children).find(
    (child) => child instanceof HTMLElement && child.hasAttribute("data-tab-swipe-panel"),
  );
  return panel instanceof HTMLElement ? panel : surface;
}

function paintSwipeOffset(
  target: HTMLElement,
  offset: number,
  state: "dragging" | "settling",
): void {
  target.dataset.tabSwipeState = state;
  target.style.setProperty(SWIPE_OFFSET_PROPERTY, `${String(offset)}px`);
}

function clearSwipeVisual(target: HTMLElement | null): void {
  if (!target) return;
  target.removeAttribute("data-tab-swipe-state");
  target.style.removeProperty(SWIPE_OFFSET_PROPERTY);
}

function safelyCapturePointer(surface: HTMLDivElement, pointerId: number): void {
  if (typeof surface.setPointerCapture !== "function") return;
  try {
    surface.setPointerCapture(pointerId);
  } catch {
    // The browser may already have cancelled the pointer for native scrolling.
  }
}

function safelyReleasePointer(surface: HTMLDivElement, pointerId: number): void {
  if (
    typeof surface.hasPointerCapture !== "function" ||
    typeof surface.releasePointerCapture !== "function"
  ) {
    return;
  }
  try {
    if (surface.hasPointerCapture(pointerId)) {
      surface.releasePointerCapture(pointerId);
    }
  } catch {
    // A cancellation can release capture before React receives the event.
  }
}

export function shouldIgnoreTabSwipeStart(target: EventTarget | null, surface: Element): boolean {
  if (!(target instanceof Element) || !surface.contains(target)) return true;
  return (
    hasNestedSwipeSurface(target, surface) ||
    hasIgnoredControl(target, surface) ||
    hasHorizontalScroller(target, surface)
  );
}

interface UseTabSwipeOptions<T extends string> {
  items: readonly T[];
  value: T;
  onChange: (next: T) => void;
  enabled?: boolean;
  minDistance?: number;
}

interface TabSwipeStart {
  activeIndex: number;
  hasVelocitySample: boolean;
  intent: TabSwipeIntent;
  lastTime: number;
  lastX: number;
  pointerId: number;
  reducedMotion: boolean;
  surface: HTMLDivElement;
  value: string;
  velocityX: number;
  visualTarget: HTMLElement;
  x: number;
  y: number;
}

interface TabSwipeHandlers {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
  onClickCapture: MouseEventHandler<HTMLDivElement>;
}

/**
 * Controlled touch-swipe behavior for an inner tab panel.
 *
 * State and URL ownership stay with the caller. Mouse drags, vertical
 * scrolling, nested tab surfaces, form fields, media scrubbers, and
 * horizontal scrollers are intentionally left alone.
 */
export function useTabSwipe<T extends string>({
  items,
  value,
  onChange,
  enabled = true,
  minDistance = DEFAULT_MIN_DISTANCE,
}: UseTabSwipeOptions<T>): TabSwipeHandlers {
  const startRef = useRef<TabSwipeStart | null>(null);
  const suppressClickRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const visualTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
      clearSwipeVisual(visualTargetRef.current);
    };
  }, []);

  function cancelSettle(): void {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    clearSwipeVisual(visualTargetRef.current);
    visualTargetRef.current = null;
  }

  function settleVisual(target: HTMLElement, reducedMotion: boolean): void {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (visualTargetRef.current && visualTargetRef.current !== target) {
      clearSwipeVisual(visualTargetRef.current);
    }
    if (reducedMotion) {
      clearSwipeVisual(target);
      visualTargetRef.current = null;
      return;
    }

    visualTargetRef.current = target;
    paintSwipeOffset(target, 0, "settling");
    settleTimerRef.current = window.setTimeout(() => {
      clearSwipeVisual(target);
      if (visualTargetRef.current === target) {
        visualTargetRef.current = null;
      }
      settleTimerRef.current = null;
    }, SETTLE_CLEANUP_MS);
  }

  function suppressReleaseClick(): void {
    suppressClickRef.current = true;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      clickTimerRef.current = null;
    }, 0);
  }

  function updateVelocity(
    start: TabSwipeStart,
    x: number,
    time: number,
    allowFirstSample: boolean,
  ): void {
    const elapsed = time - start.lastTime;
    if (elapsed > 100) {
      start.velocityX = 0;
      start.hasVelocitySample = false;
    } else if (
      elapsed > 0 &&
      x !== start.lastX &&
      (allowFirstSample || start.hasVelocitySample)
    ) {
      const instantVelocity = (x - start.lastX) / elapsed;
      start.velocityX =
        start.velocityX === 0 ? instantVelocity : start.velocityX * 0.35 + instantVelocity * 0.65;
      start.hasVelocitySample = true;
    }
    start.lastX = x;
    start.lastTime = time;
  }

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    startRef.current = null;
    cancelSettle();
    if (
      !enabled ||
      event.pointerType !== "touch" ||
      !event.isPrimary ||
      shouldIgnoreTabSwipeStart(event.target, event.currentTarget)
    ) {
      return;
    }

    const activeIndex = items.indexOf(value);
    if (activeIndex < 0) return;
    const visualTarget = getVisualTarget(event.currentTarget);
    startRef.current = {
      activeIndex,
      hasVelocitySample: false,
      intent: "pending",
      lastTime: event.timeStamp,
      lastX: event.clientX,
      pointerId: event.pointerId,
      reducedMotion: prefersReducedMotion(),
      surface: event.currentTarget,
      value,
      velocityX: 0,
      visualTarget,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (!enabled || value !== start.value || items[start.activeIndex] !== start.value) {
      startRef.current = null;
      safelyReleasePointer(start.surface, start.pointerId);
      settleVisual(start.visualTarget, start.reducedMotion);
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent === "pending") {
      start.intent = resolveTabSwipeIntent(deltaX, deltaY);
      if (start.intent === "horizontal") {
        safelyCapturePointer(start.surface, start.pointerId);
      }
    }
    if (start.intent !== "horizontal") return;

    event.preventDefault();
    updateVelocity(start, event.clientX, event.timeStamp, true);
    if (start.reducedMotion) return;

    const offset = resolveTabSwipeDragOffset({
      activeIndex: start.activeIndex,
      itemCount: items.length,
      deltaX,
    });
    visualTargetRef.current = start.visualTarget;
    paintSwipeOffset(start.visualTarget, offset, "dragging");
  };

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (start.intent === "pending") {
      start.intent = resolveTabSwipeIntent(deltaX, deltaY);
    }
    if (start.intent !== "horizontal") {
      startRef.current = null;
      safelyReleasePointer(start.surface, start.pointerId);
      clearSwipeVisual(start.visualTarget);
      return;
    }

    updateVelocity(start, event.clientX, event.timeStamp, false);
    suppressReleaseClick();
    event.preventDefault();

    startRef.current = null;
    safelyReleasePointer(start.surface, start.pointerId);

    if (!enabled || value !== start.value || items[start.activeIndex] !== start.value) {
      settleVisual(start.visualTarget, start.reducedMotion);
      return;
    }

    const targetIndex = resolveTabSwipeReleaseTargetIndex({
      activeIndex: start.activeIndex,
      itemCount: items.length,
      deltaX,
      deltaY,
      velocityX: start.velocityX,
      minDistance,
    });
    if (targetIndex !== null) {
      const next = items[targetIndex];
      if (next !== undefined) {
        onChange(next);
      }
    }
    settleVisual(start.visualTarget, start.reducedMotion);
  };

  const onPointerCancel: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    safelyReleasePointer(start.surface, start.pointerId);
    if (start.intent === "horizontal") {
      suppressReleaseClick();
      settleVisual(start.visualTarget, start.reducedMotion);
    } else {
      clearSwipeVisual(start.visualTarget);
    }
  };

  const onLostPointerCapture: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    if (start.intent === "horizontal") {
      suppressReleaseClick();
      settleVisual(start.visualTarget, start.reducedMotion);
    } else {
      clearSwipeVisual(start.visualTarget);
    }
  };

  const onClickCapture: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onClickCapture,
  };
}
