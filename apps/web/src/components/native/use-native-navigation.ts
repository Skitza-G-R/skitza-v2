"use client";

import { useEffect, useRef, type PointerEventHandler, type RefObject } from "react";

interface SwipeBackOptions {
  onBack: () => void;
  enabled?: boolean;
  edgeWidth?: number;
  threshold?: number;
}

interface SwipeBackHandlers {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
}

interface SwipeStart {
  pointerId: number;
  x: number;
  y: number;
  direction: 1 | -1;
}

export function isCompletedBackSwipe({
  deltaX,
  deltaY,
  direction,
  threshold,
}: {
  deltaX: number;
  deltaY: number;
  direction: 1 | -1;
  threshold: number;
}): boolean {
  const directionalDistance = deltaX * direction;
  return directionalDistance >= threshold && directionalDistance > Math.abs(deltaY) * 1.25;
}

/**
 * Edge-only back swipe for full-screen task flows. It does not prevent
 * vertical scrolling and only commits after a clear horizontal gesture.
 */
export function useSwipeBack({
  onBack,
  enabled = true,
  edgeWidth = 28,
  threshold = 72,
}: SwipeBackOptions): SwipeBackHandlers {
  const startRef = useRef<SwipeStart | null>(null);

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const startsAtLeadingEdge = rtl
      ? event.clientX >= rect.right - edgeWidth
      : event.clientX <= rect.left + edgeWidth;

    if (!startsAtLeadingEdge) return;

    startRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      direction: rtl ? -1 : 1,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    const start = startRef.current;
    startRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!start || start.pointerId !== event.pointerId) return;

    if (
      isCompletedBackSwipe({
        deltaX: event.clientX - start.x,
        deltaY: event.clientY - start.y,
        direction: start.direction,
        threshold,
      })
    ) {
      onBack();
    }
  };

  const onPointerCancel: PointerEventHandler<HTMLElement> = (event) => {
    startRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return { onPointerDown, onPointerUp, onPointerCancel };
}

const RESTORATION_PREFIX = "skitza:native-scroll:";

/**
 * Restores an embedded flow/list scroll position without taking over the
 * browser's page-level history restoration.
 */
export function useNativeScrollRestoration<T extends HTMLElement>(
  key: string,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const storageKey = `${RESTORATION_PREFIX}${key}`;
    try {
      const storedPosition = Number.parseFloat(window.sessionStorage.getItem(storageKey) ?? "");
      if (Number.isFinite(storedPosition)) {
        window.requestAnimationFrame(() => {
          element.scrollTop = storedPosition;
        });
      }
    } catch {
      // Storage can be unavailable in strict privacy modes. Restoration is
      // progressive enhancement, so the flow remains usable without it.
    }

    return () => {
      try {
        window.sessionStorage.setItem(storageKey, String(element.scrollTop));
      } catch {
        // See the read path above.
      }
    };
  }, [key]);

  return ref;
}
