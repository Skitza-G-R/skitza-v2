"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/cn";
import { RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE } from "~/lib/runtime-state/navigation-cache";

import { Icon, type IconName } from "./icons";

const NAV_ROW_HEIGHT = 68;
const TAP_SLOP = 10;
const INTENT_DOMINANCE = 1.15;
const TAB_SWITCH_HYSTERESIS = 8;
const NAV_Y_BAND_PADDING = 12;
const RELEASE_CLICK_GUARD_MS = 350;
const TAB_SELECTOR = "[data-liquid-glass-nav-tab]";
const MAGNIFIED_TAB_SELECTOR = "[data-liquid-glass-nav-magnified-tab]";

/**
 * One ink for every tab, at full strength.
 *
 * SK-306 took the brand amber off the active tab, and the obvious replacement
 * was full-strength ink against a dimmed 0.78 for the rest. Measured against
 * the transparency Gili asked for, that dimming is what breaks: over a black
 * album cover in light mode the inactive labels fall to 3.6:1, below the 4.5:1
 * floor for text. Ink strength turned out to be the strongest contrast lever
 * available and the only one that costs no transparency at all, so it is spent
 * here rather than on a hierarchy the tab already carries three other ways —
 * the frosted capsule, 700 against 500 weight, and a 2.4 against 2 icon
 * stroke. `aria-current="page"` carries the state non-visually.
 */
const NAV_INK = "rgb(var(--sk-nav-glass-ink))";
const LENS_WARP_FILTER_ID = "sk-nav-lens-warp";
const LENS_WARP_DISPLACEMENT = 40;

/**
 * Displacement map for the optical warp layer (SK-306 C).
 *
 * Red carries horizontal displacement, green vertical. Green is a flat 128
 * everywhere — a 68px-tall pill has no vertical depth worth bending — while
 * red runs 255 at the left rim down to a flat 128 across the middle 64% and
 * on to 0 at the right rim. `feDisplacementMap` samples the backdrop at
 * `x + scale * (red - 0.5)`, so red above 128 pulls content inward from the
 * left and below 128 pulls it inward from the right: the outer 18% at each
 * end stretches by ~22% while the middle is left untouched. That is a
 * cylindrical lens, and sampling only ever reads *inward*, so no pixel is
 * ever fetched from outside the filter region.
 */
const LENS_WARP_MAP =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='80' preserveAspectRatio='none'%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='rgb(255,128,128)'/%3E%3Cstop offset='0.03' stop-color='rgb(246,128,128)'/%3E%3Cstop offset='0.06' stop-color='rgb(222,128,128)'/%3E%3Cstop offset='0.09' stop-color='rgb(192,128,128)'/%3E%3Cstop offset='0.12' stop-color='rgb(161,128,128)'/%3E%3Cstop offset='0.15' stop-color='rgb(137,128,128)'/%3E%3Cstop offset='0.18' stop-color='rgb(128,128,128)'/%3E%3Cstop offset='0.82' stop-color='rgb(128,128,128)'/%3E%3Cstop offset='0.85' stop-color='rgb(119,128,128)'/%3E%3Cstop offset='0.88' stop-color='rgb(95,128,128)'/%3E%3Cstop offset='0.91' stop-color='rgb(64,128,128)'/%3E%3Cstop offset='0.94' stop-color='rgb(33,128,128)'/%3E%3Cstop offset='0.97' stop-color='rgb(9,128,128)'/%3E%3Cstop offset='1' stop-color='rgb(0,128,128)'/%3E%3C/linearGradient%3E%3Crect width='400' height='80' fill='url(%23g)'/%3E%3C/svg%3E";

type LensPoint = {
  clientX: number;
  clientY: number;
};

type GestureIntent = "horizontal" | "pending" | "vertical";

type LiquidGlassNavStyle = CSSProperties & {
  "--sk-nav-column-count": number;
  "--sk-nav-column-width": string;
};

export type LiquidGlassBottomNavPosition = "fixed" | "in-flow" | "overlay";

/**
 * `overlay` is the shipping mode for both app shells (SK-306). The bar used to
 * be an in-flow flex sibling *below* the scroller, so the scroll box ended
 * exactly where the bar began and the screen read as chopped off at that line
 * — page content could never pass beneath the glass. Overlaying it on the
 * scroller restores that, and because both shells are `fixed inset-0`, an
 * absolute bar is anchored to the shell rather than the document viewport:
 * iOS rubber-band still cannot carry it away, which is what SK-143 protected.
 * Scrollers pair this with `.sk-bottom-nav-inset` so the last row can still be
 * scrolled clear of the bar.
 */
const FRAME_POSITION_CLASS: Record<LiquidGlassBottomNavPosition, string> = {
  fixed:
    "fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] flex h-[var(--sk-viewport-height,100dvh)] items-end pointer-events-none",
  "in-flow": "relative",
  overlay: "absolute inset-x-0 bottom-0 pointer-events-none",
};

export type LiquidGlassBottomNavTab<Id extends string = string> = Readonly<{
  id: Id;
  label: string;
  href: string;
  icon: IconName;
  active: boolean;
  prefetch?: boolean | null;
  /**
   * Keeps the Link focusable so a blocked activation can explain why it
   * cannot navigate. The shared surface prevents the navigation and invokes
   * `onNavigationBlocked`.
   */
  navigationBlocked?: boolean;
}>;

export type LiquidGlassBottomNavProps<Id extends string = string> = Readonly<{
  ariaLabel: string;
  tabs: readonly LiquidGlassBottomNavTab<Id>[];
  position?: LiquidGlassBottomNavPosition;
  frameClassName?: string;
  navClassName?: string;
  onTabClick?: (
    event: ReactMouseEvent<HTMLAnchorElement>,
    tab: LiquidGlassBottomNavTab<Id>,
  ) => void;
  onTabNavigate?: (tab: LiquidGlassBottomNavTab<Id>) => void;
  onNavigationBlocked?: (tab: LiquidGlassBottomNavTab<Id>) => void;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function getTabs(nav: HTMLElement): HTMLElement[] {
  return [...nav.querySelectorAll<HTMLElement>(TAB_SELECTOR)];
}

function getMagnifiedTabs(nav: HTMLElement): HTMLElement[] {
  return [...nav.querySelectorAll<HTMLElement>(MAGNIFIED_TAB_SELECTOR)];
}

function setTabProximities(nav: HTMLElement, x: number, navLeft: number): void {
  const magnifiedTabs = getMagnifiedTabs(nav);
  const tabs = getTabs(nav).map((tab) => {
    const rect = tab.getBoundingClientRect();
    return {
      center: rect.left - navLeft + rect.width / 2,
      tab,
      width: rect.width,
    };
  });

  tabs.forEach(({ center, tab, width }, index) => {
    const distanceInTabs = width > 0 ? Math.abs(x - center) / width : 0;
    const proximity = Math.max(0, 1 - distanceInTabs / 1.35);
    const value = proximity.toFixed(3);

    tab.style.setProperty("--sk-nav-proximity", value);
    magnifiedTabs[index]?.style.setProperty("--sk-nav-proximity", value);
  });
}

function resetTabProximities(nav: HTMLElement): void {
  [...getTabs(nav), ...getMagnifiedTabs(nav)].forEach((tab) => {
    tab.style.setProperty("--sk-nav-proximity", "0");
  });
}

function setLensCoordinates(nav: HTMLElement, x: number, y: number): void {
  nav.style.setProperty("--sk-nav-lens-x", `${String(Math.round(x * 10) / 10)}px`);
  nav.style.setProperty("--sk-nav-lens-y", `${String(Math.round(y * 10) / 10)}px`);
}

function setLensWidth(nav: HTMLElement, tabWidth: number): number {
  const lensWidth = Math.max(0, tabWidth - 2);
  if (lensWidth > 0) {
    nav.style.setProperty("--sk-nav-lens-width", `${String(Math.round(lensWidth * 10) / 10)}px`);
  }
  return lensWidth;
}

function measuredTabWidthAtPointer(nav: HTMLElement, navRect: DOMRect, clientX: number): number {
  const tabs = getTabs(nav);
  const measured = tabs.map((tab) => tab.getBoundingClientRect()).filter((rect) => rect.width > 0);
  const containing = measured.find((rect) => clientX >= rect.left && clientX <= rect.right);
  const nearest = measured.reduce<DOMRect | null>((closest, rect) => {
    if (!closest) return rect;
    const rectDistance = Math.abs(clientX - (rect.left + rect.width / 2));
    const closestDistance = Math.abs(clientX - (closest.left + closest.width / 2));
    return rectDistance < closestDistance ? rect : closest;
  }, null);

  return containing?.width ?? nearest?.width ?? navRect.width / Math.max(1, tabs.length);
}

function setLensFromPointer(
  nav: HTMLElement,
  rect: DOMRect,
  { clientX }: LensPoint,
): void {
  const lensWidth = setLensWidth(nav, measuredTabWidthAtPointer(nav, rect, clientX));
  const lensHalfWidth = lensWidth / 2;
  const x = clamp(clientX - rect.left, lensHalfWidth, rect.width - lensHalfWidth);
  const y = NAV_ROW_HEIGHT / 2;

  setLensCoordinates(nav, x, y);
  setTabProximities(nav, x, rect.left);
}

function positionLensOnTab(nav: HTMLElement, tab: HTMLElement): void {
  const navRect = nav.getBoundingClientRect();
  const activeRect = tab.getBoundingClientRect();
  setLensWidth(nav, activeRect.width || navRect.width / Math.max(1, getTabs(nav).length));
  setLensCoordinates(
    nav,
    activeRect.left - navRect.left + activeRect.width / 2,
    activeRect.top - navRect.top + activeRect.height / 2,
  );
  nav.dataset.lensReady = "true";
}

function positionLensOnActiveTab(nav: HTMLElement): void {
  const activeTab = nav.querySelector<HTMLElement>(`${TAB_SELECTOR}[data-active="true"]`);
  if (activeTab) positionLensOnTab(nav, activeTab);
}

function findStableTabAtPointer(
  nav: HTMLElement,
  navRect: DOMRect,
  { clientX, clientY }: LensPoint,
): HTMLElement | null {
  if (clientY < navRect.top - NAV_Y_BAND_PADDING || clientY > navRect.bottom + NAV_Y_BAND_PADDING) {
    return null;
  }

  const tabs = getTabs(nav)
    .map((tab) => ({ rect: tab.getBoundingClientRect(), tab }))
    .sort((left, right) => left.rect.left - right.rect.left);
  const targetIndex = tabs.findIndex(({ rect }) => clientX >= rect.left && clientX <= rect.right);
  if (targetIndex < 0) return null;

  const target = tabs[targetIndex];
  if (!target) return null;
  const inset = Math.min(TAB_SWITCH_HYSTERESIS, target.rect.width / 4);
  const stableLeft = target.rect.left + (targetIndex === 0 ? 0 : inset);
  const stableRight = target.rect.right + (targetIndex === tabs.length - 1 ? 0 : -inset);

  return clientX >= stableLeft && clientX <= stableRight ? target.tab : null;
}

function LiquidGlassTabVisual<Id extends string>({
  tab,
}: {
  tab: LiquidGlassBottomNavTab<Id>;
}): ReactNode {
  return (
    <>
      <Icon
        name={tab.icon}
        size={24}
        strokeWidth={tab.active ? 2.4 : 2}
        className="liquid-glass-bottom-nav__icon"
      />
      <span
        className="liquid-glass-bottom-nav__label"
        style={{
          fontSize: 11,
          fontWeight: tab.active ? 700 : 500,
          letterSpacing: "-0.005em",
        }}
      >
        {tab.label}
      </span>
    </>
  );
}

/**
 * Shared mobile navigation surface for both Skitza apps and deterministic
 * approval previews. It owns only the glass interaction and Link behavior;
 * each adapter supplies its routes, active state, and navigation side effects.
 */
export function LiquidGlassBottomNav<Id extends string>({
  ariaLabel,
  tabs,
  position = "in-flow",
  frameClassName,
  navClassName,
  onTabClick,
  onTabNavigate,
  onNavigationBlocked,
}: LiquidGlassBottomNavProps<Id>): ReactNode {
  const activeId = tabs.find((tab) => tab.active)?.id ?? null;
  const navRef = useRef<HTMLElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const navRectRef = useRef<DOMRect | null>(null);
  const pendingPointRef = useRef<LensPoint | null>(null);
  const pointerStartRef = useRef<LensPoint | null>(null);
  const pressedTabRef = useRef<HTMLElement | null>(null);
  const crossedDestinationRef = useRef<string | null>(null);
  const navigatedTabRef = useRef<HTMLElement | null>(null);
  const gestureIntentRef = useRef<GestureIntent>("pending");
  const liveDragClickRef = useRef(false);
  const suppressClickRef = useRef(false);
  const releaseClickGuardUntilRef = useRef(0);
  const releaseClickDestinationsRef = useRef<readonly string[]>([]);
  const releaseClickTargetsRef = useRef<readonly HTMLElement[]>([]);
  const blockedGestureNoticeShownRef = useRef(false);
  const lensFrameRef = useRef<number | null>(null);
  const settleFrameRef = useRef<number | null>(null);

  const clearReleaseClickGuard = (): void => {
    for (const target of releaseClickTargetsRef.current) {
      target.removeAttribute(RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE);
    }
    suppressClickRef.current = false;
    releaseClickGuardUntilRef.current = 0;
    releaseClickDestinationsRef.current = [];
    releaseClickTargetsRef.current = [];
  };

  const armReleaseClickGuard = (): void => {
    const targets = [...new Set([pressedTabRef.current, navigatedTabRef.current])].filter(
      (target): target is HTMLElement => target !== null,
    );
    const destinations = targets
      .map((target) => target.dataset.skNavDestination)
      .filter((destination): destination is string => Boolean(destination));
    const deadline = Date.now() + RELEASE_CLICK_GUARD_MS;

    suppressClickRef.current = destinations.length > 0;
    releaseClickGuardUntilRef.current = deadline;
    releaseClickDestinationsRef.current = [...new Set(destinations)];
    releaseClickTargetsRef.current = targets;
    for (const target of targets) {
      target.setAttribute(RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE, String(deadline));
    }
  };

  const cancelLensFrame = (): void => {
    if (lensFrameRef.current === null) return;
    window.cancelAnimationFrame(lensFrameRef.current);
    lensFrameRef.current = null;
  };

  const flushPendingLensPoint = (): void => {
    lensFrameRef.current = null;
    const nav = navRef.current;
    const point = pendingPointRef.current;
    if (!nav || !navRectRef.current || !point) return;

    // Re-measure rather than trust the pointerdown rect. The press grows the
    // whole pill by 7%, so a rect cached before `data-interacting` was set
    // leaves the lens trailing the finger by up to ~13px at the far ends of
    // the bar. This frame already reads ten tab rects below, so one more
    // measurement of the same dirty layout costs nothing.
    const rect = nav.getBoundingClientRect();
    navRectRef.current = rect;
    setLensFromPointer(nav, rect, point);
  };

  const queueLensPoint = (point: LensPoint): void => {
    pendingPointRef.current = point;
    if (lensFrameRef.current !== null) return;
    lensFrameRef.current = window.requestAnimationFrame(flushPendingLensPoint);
  };

  const settleLens = (nav: HTMLElement, destinationTab: HTMLElement | null = null): void => {
    cancelLensFrame();
    pendingPointRef.current = null;
    pointerStartRef.current = null;
    pressedTabRef.current = null;
    crossedDestinationRef.current = null;
    navigatedTabRef.current = null;
    gestureIntentRef.current = "pending";
    navRectRef.current = null;
    activePointerIdRef.current = null;
    blockedGestureNoticeShownRef.current = false;
    nav.dataset.interacting = "false";
    resetTabProximities(nav);

    if (settleFrameRef.current !== null) {
      window.cancelAnimationFrame(settleFrameRef.current);
    }
    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = null;
      if (destinationTab?.isConnected) {
        positionLensOnTab(nav, destinationTab);
      } else {
        positionLensOnActiveTab(nav);
      }
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;

    const nav = event.currentTarget;
    if (settleFrameRef.current !== null) {
      window.cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
    activePointerIdRef.current = event.pointerId;
    navRectRef.current = nav.getBoundingClientRect();
    pointerStartRef.current = { clientX: event.clientX, clientY: event.clientY };
    pressedTabRef.current =
      event.target instanceof Element ? event.target.closest<HTMLElement>(TAB_SELECTOR) : null;
    crossedDestinationRef.current = pressedTabRef.current?.dataset.skNavDestination ?? null;
    navigatedTabRef.current = null;
    gestureIntentRef.current = "pending";
    blockedGestureNoticeShownRef.current = false;
    clearReleaseClickGuard();
    nav.dataset.interacting = "true";
    setLensFromPointer(nav, navRectRef.current, event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const start = pointerStartRef.current;
    if (!start) return;

    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance > TAP_SLOP) {
      suppressClickRef.current = true;
      if (gestureIntentRef.current === "pending") {
        const horizontalDistance = Math.abs(deltaX);
        const verticalDistance = Math.abs(deltaY);
        if (horizontalDistance > verticalDistance * INTENT_DOMINANCE) {
          gestureIntentRef.current = "horizontal";
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // A coalesced move can arrive after pointer cancellation.
            // The release-click guard below still protects that fallback.
          }
        } else if (verticalDistance > horizontalDistance * INTENT_DOMINANCE) {
          gestureIntentRef.current = "vertical";
          cancelLensFrame();
          pendingPointRef.current = null;
          event.currentTarget.dataset.interacting = "false";
          resetTabProximities(event.currentTarget);
          positionLensOnActiveTab(event.currentTarget);
        }
      }
    }

    if (gestureIntentRef.current === "vertical") return;

    if (gestureIntentRef.current === "horizontal") {
      const navRect = navRectRef.current;
      const destinationTab = navRect
        ? findStableTabAtPointer(event.currentTarget, navRect, event)
        : null;
      const destination = destinationTab?.dataset.skNavDestination;
      if (destinationTab && destination && destination !== crossedDestinationRef.current) {
        crossedDestinationRef.current = destination;
        navigatedTabRef.current = destinationTab;
        clearReleaseClickGuard();
        liveDragClickRef.current = true;
        try {
          destinationTab.click();
        } finally {
          liveDragClickRef.current = false;
          suppressClickRef.current = true;
        }
        if (activePointerIdRef.current !== event.pointerId) return;
      }
    }

    queueLensPoint(event);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const start = pointerStartRef.current;
    const moved =
      !start || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP;
    const isTap = event.type === "pointerup" && !moved && !suppressClickRef.current;
    const destinationTab = isTap
      ? pressedTabRef.current
      : gestureIntentRef.current === "horizontal"
        ? navigatedTabRef.current
        : null;
    if (event.type === "pointerup" && !isTap) {
      armReleaseClickGuard();
    } else {
      clearReleaseClickGuard();
    }
    settleLens(event.currentTarget, destinationTab);
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "mouse" || activePointerIdRef.current !== event.pointerId) return;
    settleLens(
      event.currentTarget,
      gestureIntentRef.current === "horizontal" ? navigatedTabRef.current : null,
    );
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    handlePointerEnd(event);
  };

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const syncActiveLens = () => {
      if (activePointerIdRef.current === null) positionLensOnActiveTab(nav);
    };

    syncActiveLens();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncActiveLens);
    resizeObserver?.observe(nav);
    window.addEventListener("resize", syncActiveLens, { passive: true });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncActiveLens);
      cancelLensFrame();
      if (settleFrameRef.current !== null) {
        window.cancelAnimationFrame(settleFrameRef.current);
        settleFrameRef.current = null;
      }
      resetTabProximities(nav);
      clearReleaseClickGuard();
    };
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || activePointerIdRef.current !== null) return;
    positionLensOnActiveTab(nav);
  }, [activeId, tabs.length]);

  const columnCount = Math.max(1, tabs.length);
  const navStyle: LiquidGlassNavStyle = {
    "--sk-nav-column-count": columnCount,
    "--sk-nav-column-width": `${String(100 / columnCount)}%`,
  };

  return (
    <div
      data-liquid-glass-bottom-nav-frame={position}
      className={cn(
        "liquid-glass-bottom-nav-frame z-30 shrink-0 lg:hidden",
        FRAME_POSITION_CLASS[position],
        frameClassName,
      )}
      style={{
        padding:
          "0 max(12px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width="0"
        height="0"
        className="absolute h-0 w-0"
      >
        <filter
          id={LENS_WARP_FILTER_ID}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          {/* A neutral 128 grey under the map means zero displacement, so if
              the browser never paints the feImage the layer renders its
              backdrop untouched — invisible — instead of shoving the whole
              page sideways by half the scale. That is what makes this safe to
              ship before anyone has seen it on an iPhone.

              The id is fixed rather than per-instance. Two bars can share a
              document — the SK-298 simulation renders one inside the producer
              shell — and a `useId()` value would carry characters that need
              escaping inside `url(#…)`. Duplicate definitions are identical,
              and a fragment reference resolves to the first, so both layers
              get the same lens either way. */}
          <feFlood floodColor="rgb(128,128,128)" floodOpacity="1" result="neutral" />
          <feImage href={LENS_WARP_MAP} preserveAspectRatio="none" result="ramp" />
          <feMerge result="map">
            <feMergeNode in="neutral" />
            <feMergeNode in="ramp" />
          </feMerge>
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={LENS_WARP_DISPLACEMENT}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
      <div
        data-liquid-glass-bottom-nav-stack=""
        className={cn(
          "liquid-glass-bottom-nav__stack mx-auto w-full max-w-[420px]",
          position !== "in-flow" && "pointer-events-auto",
        )}
      >
        <span
          className="liquid-glass-bottom-nav__warp"
          aria-hidden="true"
          style={{
            // Inline rather than in globals.css on purpose: a filter `url(#…)`
            // written in an external stylesheet has historically resolved
            // against the stylesheet's URL rather than the document in some
            // engines, which silently yields no filter at all. An inline style
            // is unambiguously document-relative.
            backdropFilter: `url(#${LENS_WARP_FILTER_ID})`,
            WebkitBackdropFilter: `url(#${LENS_WARP_FILTER_ID})`,
          }}
        />
        <span className="liquid-glass-bottom-nav__pane" aria-hidden="true" />
        <span className="liquid-glass-bottom-nav__rim" aria-hidden="true" />
        <nav
          ref={navRef}
          role="navigation"
          aria-label={ariaLabel}
          data-interacting="false"
          data-lens-ready="false"
          data-liquid-glass-bottom-nav=""
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handleLostPointerCapture}
          onPointerLeave={handlePointerLeave}
          className={cn("liquid-glass-bottom-nav__glass grid w-full", navClassName)}
          style={navStyle}
        >
          <span className="liquid-glass-bottom-nav__lens" aria-hidden="true" />
          <span className="liquid-glass-bottom-nav__magnifier" aria-hidden="true">
            <span className="liquid-glass-bottom-nav__magnifier-grid">
              {tabs.map((tab) => (
                <span
                  key={tab.id}
                  data-active={tab.active ? "true" : "false"}
                  data-liquid-glass-nav-magnified-tab=""
                  className="liquid-glass-bottom-nav__magnified-tab flex min-w-0 flex-col items-center justify-center gap-1 py-2.5"
                  style={{
                    minHeight: 68,
                    color: NAV_INK,
                  }}
                >
                  <LiquidGlassTabVisual tab={tab} />
                </span>
              ))}
            </span>
          </span>

          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              draggable={false}
              data-sk-nav-destination={tab.href}
              prefetch={tab.prefetch === undefined ? false : tab.prefetch}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  clearReleaseClickGuard();
                }
              }}
              onNavigate={() => {
                onTabNavigate?.(tab);
              }}
              aria-disabled={tab.navigationBlocked ?? false}
              onClick={(event) => {
                const isLiveDragClick = liveDragClickRef.current;
                const isGuardedReleaseClick =
                  suppressClickRef.current &&
                  !isLiveDragClick &&
                  Date.now() <= releaseClickGuardUntilRef.current &&
                  releaseClickDestinationsRef.current.includes(tab.href);
                if (isGuardedReleaseClick) {
                  event.preventDefault();
                  clearReleaseClickGuard();
                  if (navRef.current) settleLens(navRef.current);
                  return;
                }
                if (!isLiveDragClick) {
                  clearReleaseClickGuard();
                } else {
                  suppressClickRef.current = false;
                }

                onTabClick?.(event, tab);
                if (!tab.navigationBlocked) return;

                event.preventDefault();
                if (isLiveDragClick) {
                  armReleaseClickGuard();
                  if (!blockedGestureNoticeShownRef.current) {
                    blockedGestureNoticeShownRef.current = true;
                    onNavigationBlocked?.(tab);
                  }
                } else {
                  if (navRef.current) settleLens(navRef.current);
                  onNavigationBlocked?.(tab);
                }
              }}
              {...(tab.active ? { "aria-current": "page" as const } : {})}
              data-active={tab.active ? "true" : "false"}
              data-liquid-glass-nav-tab=""
              className="liquid-glass-bottom-nav__tab sk-press relative flex min-w-0 flex-col items-center justify-center gap-1 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                minHeight: 68,
                color: NAV_INK,
              }}
            >
              <LiquidGlassTabVisual tab={tab} />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
