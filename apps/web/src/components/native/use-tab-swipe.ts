"use client";

import {
  useRef,
  type MouseEventHandler,
  type PointerEventHandler,
} from "react";

const DEFAULT_MIN_DISTANCE = 56;
const HORIZONTAL_INTENT_RATIO = 1.25;
const DRAG_INTENT_DISTANCE = 12;
const DRAG_INTENT_RATIO = 1.1;
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

function hasHorizontalDragIntent(deltaX: number, deltaY: number): boolean {
  return (
    Math.abs(deltaX) > DRAG_INTENT_DISTANCE &&
    Math.abs(deltaX) > Math.abs(deltaY) * DRAG_INTENT_RATIO
  );
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
  pointerId: number;
  x: number;
  y: number;
}

interface TabSwipeHandlers {
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
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

  const onPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    startRef.current = null;
    if (
      !enabled ||
      event.pointerType !== "touch" ||
      !event.isPrimary ||
      shouldIgnoreTabSwipeStart(event.target, event.currentTarget)
    ) {
      return;
    }

    startRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (hasHorizontalDragIntent(deltaX, deltaY)) {
      event.preventDefault();
    }
  };

  const onPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (hasHorizontalDragIntent(deltaX, deltaY)) {
      suppressClickRef.current = true;
      event.preventDefault();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }

    const activeIndex = items.indexOf(value);
    const targetIndex = resolveTabSwipeTargetIndex({
      activeIndex,
      itemCount: items.length,
      deltaX,
      deltaY,
      minDistance,
    });
    if (targetIndex === null) return;

    const next = items[targetIndex];
    if (next === undefined) return;

    onChange(next);
  };

  const onPointerCancel: PointerEventHandler<HTMLDivElement> = () => {
    startRef.current = null;
  };

  const onClickCapture: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}
