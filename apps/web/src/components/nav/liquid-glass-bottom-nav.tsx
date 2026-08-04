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

type LensPoint = {
  clientX: number;
  clientY: number;
};

type GestureIntent = "horizontal" | "pending" | "vertical";

type LiquidGlassNavStyle = CSSProperties & {
  "--sk-nav-column-count": number;
  "--sk-nav-column-width": string;
};

export type LiquidGlassBottomNavPosition = "fixed" | "in-flow";

export type LiquidGlassBottomNavTab<Id extends string = string> = Readonly<{
  id: Id;
  label: string;
  href: string;
  icon: IconName;
  active: boolean;
  prefetch?: boolean;
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
    const rect = navRectRef.current;
    const point = pendingPointRef.current;
    if (!nav || !rect || !point) return;

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
        position === "fixed"
          ? "fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] flex h-[var(--sk-viewport-height,100dvh)] items-end pointer-events-none"
          : "relative",
        frameClassName,
      )}
      style={{
        padding:
          "0 max(12px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
      }}
    >
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
        className={cn(
          "liquid-glass-bottom-nav__glass mx-auto grid w-full max-w-[420px]",
          position === "fixed" && "pointer-events-auto",
          navClassName,
        )}
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
                  color: tab.active
                    ? "rgb(var(--brand-primary))"
                    : "rgb(var(--fg-onsidebar) / 0.68)",
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
            prefetch={tab.prefetch ?? false}
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
              color: tab.active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.68)",
            }}
          >
            <LiquidGlassTabVisual tab={tab} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
