"use client";

import { RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const REFRESH_THRESHOLD_PX = 72;
const HORIZONTAL_CANCEL_RATIO = 1;
const INDICATOR_RESISTANCE = 0.65;
const INDICATOR_MAX_OFFSET_PX = 52;
const INDICATOR_FADE_START_PX = 8;
const INDICATOR_FADE_DISTANCE_PX = 16;

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
 * Gives the parent shell scroller one consistent elastic pull affordance.
 * Artist Home and Producer Home also refresh after the release threshold;
 * other standing pages only move with the finger and settle back into place.
 * Focused flows disable this controller because they own a nested scroller.
 */
export function HomePullToRefresh({
  homePath,
  enabled = true,
}: {
  homePath: HomePath;
  enabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const markerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<PullGesture | null>(null);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPending, startTransition] = useTransition();
  const homeRefreshEnabled = normalizedPath(pathname) === homePath;

  useEffect(() => {
    if (!enabled) return;
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

      // Safari can render its nested-scroller boundary affordance as a thin
      // colored line while the fixed app shell stays still. Cancel only this
      // downward-at-the-top boundary action; ordinary and horizontal scrolling
      // remain native. The spacer below supplies the visible elastic motion.
      if (event.cancelable) event.preventDefault();
      pullDistanceRef.current = deltaY;
      setPullDistance(deltaY);
    };

    const onTouchEnd = () => {
      const shouldRefresh =
        homeRefreshEnabled &&
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
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    surface.addEventListener("touchend", onTouchEnd, { passive: true });
    surface.addEventListener("touchcancel", resetPull, { passive: true });

    return () => {
      surface.removeEventListener("touchstart", onTouchStart);
      surface.removeEventListener("touchmove", onTouchMove);
      surface.removeEventListener("touchend", onTouchEnd);
      surface.removeEventListener("touchcancel", resetPull);
    };
  }, [enabled, homeRefreshEnabled, isPending, router, startTransition]);

  if (!enabled) return null;

  const state =
    homeRefreshEnabled && isPending
      ? "refreshing"
      : homeRefreshEnabled && pullDistance >= REFRESH_THRESHOLD_PX
        ? "ready"
        : pullDistance > 0
          ? "pulling"
          : "idle";
  const indicatorOffset = isPending
    ? INDICATOR_MAX_OFFSET_PX
    : Math.min(INDICATOR_MAX_OFFSET_PX, pullDistance * INDICATOR_RESISTANCE);
  const indicatorOpacity = Math.min(
    1,
    Math.max(0, (indicatorOffset - INDICATOR_FADE_START_PX) / INDICATOR_FADE_DISTANCE_PX),
  );
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
      data-home-refresh={homeRefreshEnabled ? "true" : "false"}
      className={`pointer-events-none relative z-[35] flex shrink-0 justify-center overflow-visible ${state === "idle" ? "transition-[height] duration-200 ease-out motion-reduce:transition-none" : ""}`}
      style={{ height: `${String(indicatorOffset)}px` }}
      role={homeRefreshEnabled ? "status" : undefined}
      aria-live={homeRefreshEnabled ? "polite" : undefined}
      aria-hidden={!homeRefreshEnabled || state === "idle"}
    >
      {homeRefreshEnabled ? (
        <div
          className="absolute top-2 inline-flex h-9 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] px-3 text-[11px] font-semibold text-[rgb(var(--fg-secondary))] shadow-[var(--shadow-md)] backdrop-blur-lg transition-[opacity,transform] duration-150 motion-reduce:transition-none"
          style={{
            opacity: state === "idle" ? 0 : indicatorOpacity,
            transform: `scale(${String(0.94 + indicatorOpacity * 0.06)})`,
          }}
        >
          <RefreshCw
            aria-hidden
            className={`h-3.5 w-3.5 ${isPending ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          <span>{label}</span>
        </div>
      ) : null}
    </div>
  );
}
