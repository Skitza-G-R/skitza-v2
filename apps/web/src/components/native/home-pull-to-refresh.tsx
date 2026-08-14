"use client";

import { RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const REFRESH_THRESHOLD_PX = 72;
const HORIZONTAL_CANCEL_RATIO = 1;
const INDICATOR_RESISTANCE = 0.65;
const INDICATOR_MAX_OFFSET_PX = 52;
const INDICATOR_HIDDEN_OFFSET_PX = 46;

type HomePath = "/artist" | "/dashboard";

interface PullGesture {
  startX: number;
  startY: number;
}

function firstTouch(event: TouchEvent): Touch | null {
  return event.touches[0] ?? null;
}

function normalizedPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Adds a passive pull-to-refresh gesture to the component's parent scroll
 * surface. The shell mounts it as the first child of Artist Home and Producer
 * Home; every other route renders nothing and installs no gesture listeners.
 */
export function HomePullToRefresh({ homePath }: { homePath: HomePath }) {
  const pathname = usePathname();
  const router = useRouter();
  const markerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<PullGesture | null>(null);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPending, startTransition] = useTransition();
  const active = normalizedPath(pathname) === homePath;

  useEffect(() => {
    if (!active) return;
    const surface = markerRef.current?.parentElement;
    if (!(surface instanceof HTMLElement)) return;

    const resetPull = () => {
      gestureRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    const onTouchStart = (event: TouchEvent) => {
      const touch = firstTouch(event);
      if (isPending || event.touches.length !== 1 || !touch || surface.scrollTop > 0) {
        resetPull();
        return;
      }
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY };
      pullDistanceRef.current = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = firstTouch(event);
      if (!gesture || event.touches.length !== 1 || !touch || surface.scrollTop > 0) {
        resetPull();
        return;
      }

      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;
      if (deltaY <= 0 || Math.abs(deltaX) >= deltaY * HORIZONTAL_CANCEL_RATIO) {
        resetPull();
        return;
      }

      pullDistanceRef.current = deltaY;
      setPullDistance(deltaY);
    };

    const onTouchEnd = () => {
      const shouldRefresh =
        gestureRef.current !== null &&
        pullDistanceRef.current >= REFRESH_THRESHOLD_PX &&
        surface.scrollTop <= 0 &&
        !isPending;
      resetPull();
      if (!shouldRefresh) return;
      startTransition(() => {
        router.refresh();
      });
    };

    surface.addEventListener("touchstart", onTouchStart, { passive: true });
    surface.addEventListener("touchmove", onTouchMove, { passive: true });
    surface.addEventListener("touchend", onTouchEnd, { passive: true });
    surface.addEventListener("touchcancel", resetPull, { passive: true });

    return () => {
      surface.removeEventListener("touchstart", onTouchStart);
      surface.removeEventListener("touchmove", onTouchMove);
      surface.removeEventListener("touchend", onTouchEnd);
      surface.removeEventListener("touchcancel", resetPull);
    };
  }, [active, isPending, router, startTransition]);

  if (!active) return null;

  const state = isPending
    ? "refreshing"
    : pullDistance >= REFRESH_THRESHOLD_PX
      ? "ready"
      : pullDistance > 0
        ? "pulling"
        : "idle";
  const indicatorOffset = isPending
    ? INDICATOR_MAX_OFFSET_PX
    : Math.min(INDICATOR_MAX_OFFSET_PX, pullDistance * INDICATOR_RESISTANCE);
  const label = isPending
    ? "Refreshing"
    : state === "ready"
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      ref={markerRef}
      data-testid="home-pull-to-refresh"
      data-state={state}
      className="pointer-events-none sticky top-0 z-[65] flex h-0 justify-center overflow-visible"
      role="status"
      aria-live="polite"
      aria-hidden={state === "idle"}
    >
      <div
        className="mt-2 inline-flex h-9 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] px-3 text-[11px] font-semibold text-[rgb(var(--fg-secondary))] shadow-[var(--shadow-md)] backdrop-blur-lg transition-[transform,opacity] duration-150 motion-reduce:transition-none"
        style={{
          opacity: state === "idle" ? 0 : 1,
          transform: `translate3d(0, ${String(indicatorOffset - INDICATOR_HIDDEN_OFFSET_PX)}px, 0)`,
        }}
      >
        <RefreshCw
          aria-hidden
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}
