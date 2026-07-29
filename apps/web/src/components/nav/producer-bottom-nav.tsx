"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
  RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE,
} from "~/lib/runtime-state/navigation-cache";

import { Icon, type IconName } from "./icons";

// ─── Producer mobile bottom nav (<lg) ───────────────────────────────
//
// Replaces the prior light-surface MobileBottomNav (with its centre
// "+" FAB) with the locked design's dark 5-tab bar. Per CLAUDE.md the
// producer surface was historically desktop-only; Raz approved mobile
// producer for v1 (2026-05-05), so this nav is the producer's mobile
// chrome.
//
// Visual: one compact Liquid Glass pill with an amber active lens.
// The transparent frame owns the iOS safe-area clearance so the
// visible glass and its 68px tab row stay centered above the Home
// Indicator without a dark empty footer.
//
// Routes are mapped per Gili's approved Payments navigation — five
// mobile tabs with Store and Settings under the Account menu in the
// mobile top bar. The mobile
// tab shape leans on the design source's `PROD_TABS` (notes/
// shell.producer.jsx).
//
// Active state derivation reuses `getActiveKey()` so the same URL
// triggers the same active state on both mobile + desktop.
//
// Portfolio tab removed 2026-05-15 to keep parity with the desktop
// rail — see producer-sidebar.tsx for the rationale. The
// /dashboard/portfolio route still exists and is reachable from
// inside the Store experience.

type ProducerMobileTab = {
  id: ActiveKey;
  label: string;
  href: string;
  icon: IconName;
};

const PROD_TABS: readonly ProducerMobileTab[] = [
  { id: "music", label: "Music", href: "/dashboard/music", icon: "music" },
  { id: "clients-projects", label: "Clients", href: "/dashboard/clients-projects", icon: "users" },
  { id: "today", label: "Today", href: "/dashboard", icon: "home" },
  // SK-56: phones land on the Sessions tab — the week-grid Schedule
  // tab is desktop-only (useless at 390px, per Gili's mobile audit).
  // Active-state detection is pathname-based, so the query is inert.
  { id: "calendar", label: "Calendar", href: "/dashboard/calendar?tab=sessions", icon: "calendar" },
  { id: "payments", label: "Payments", href: "/dashboard/payments", icon: "payments" },
] as const;

const NAV_ROW_HEIGHT = 68;
const LENS_MIN_HALF_WIDTH = 33;
const LENS_MAX_HALF_WIDTH = 41;
const TAP_SLOP = 10;
const INTENT_DOMINANCE = 1.15;
const TAB_SWITCH_HYSTERESIS = 8;
const NAV_Y_BAND_PADDING = 12;
const RELEASE_CLICK_GUARD_MS = 350;

type LensPoint = {
  clientX: number;
  clientY: number;
};

type GestureIntent = "horizontal" | "pending" | "vertical";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function setTabProximities(nav: HTMLElement, x: number, navLeft: number): void {
  const magnifiedTabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-magnified-tab]")];
  const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")].map((tab) => {
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
  nav
    .querySelectorAll<HTMLElement>("[data-producer-nav-tab], [data-producer-nav-magnified-tab]")
    .forEach((tab) => {
      tab.style.setProperty("--sk-nav-proximity", "0");
    });
}

function setLensCoordinates(nav: HTMLElement, x: number, y: number): void {
  nav.style.setProperty("--sk-nav-lens-x", `${String(Math.round(x * 10) / 10)}px`);
  nav.style.setProperty("--sk-nav-lens-y", `${String(Math.round(y * 10) / 10)}px`);
}

function setLensFromPointer(
  nav: HTMLElement,
  rect: DOMRect,
  { clientX, clientY }: LensPoint,
): void {
  const lensHalfWidth = clamp(rect.width / 10 - 1, LENS_MIN_HALF_WIDTH, LENS_MAX_HALF_WIDTH);
  const x = clamp(clientX - rect.left, lensHalfWidth, rect.width - lensHalfWidth);
  const y = clamp(
    clientY - rect.top,
    10,
    Math.min(NAV_ROW_HEIGHT - 10, Math.max(10, rect.height - 10)),
  );

  setLensCoordinates(nav, x, y);
  setTabProximities(nav, x, rect.left);
}

function positionLensOnTab(nav: HTMLElement, tab: HTMLElement): void {
  const navRect = nav.getBoundingClientRect();
  const activeRect = tab.getBoundingClientRect();
  setLensCoordinates(
    nav,
    activeRect.left - navRect.left + activeRect.width / 2,
    activeRect.top - navRect.top + activeRect.height / 2,
  );
  nav.dataset.lensReady = "true";
}

function positionLensOnActiveTab(nav: HTMLElement): void {
  const activeTab = nav.querySelector<HTMLElement>('[data-producer-nav-tab][data-active="true"]');
  if (activeTab) positionLensOnTab(nav, activeTab);
}

function findStableTabAtPointer(
  nav: HTMLElement,
  navRect: DOMRect,
  { clientX, clientY }: LensPoint,
): HTMLElement | null {
  if (
    clientY < navRect.top - NAV_Y_BAND_PADDING ||
    clientY > navRect.bottom + NAV_Y_BAND_PADDING
  ) {
    return null;
  }

  const tabs = [...nav.querySelectorAll<HTMLElement>("[data-producer-nav-tab]")]
    .map((tab) => ({ rect: tab.getBoundingClientRect(), tab }))
    .sort((left, right) => left.rect.left - right.rect.left);
  const targetIndex = tabs.findIndex(
    ({ rect }) => clientX >= rect.left && clientX <= rect.right,
  );
  if (targetIndex < 0) return null;

  const target = tabs[targetIndex];
  if (!target) return null;
  const inset = Math.min(TAB_SWITCH_HYSTERESIS, target.rect.width / 4);
  const stableLeft = target.rect.left + (targetIndex === 0 ? 0 : inset);
  const stableRight =
    target.rect.right + (targetIndex === tabs.length - 1 ? 0 : -inset);

  return clientX >= stableLeft && clientX <= stableRight ? target.tab : null;
}

function ProducerTabVisual({
  tab,
  isActive,
}: {
  tab: ProducerMobileTab;
  isActive: boolean;
}): ReactNode {
  return (
    <>
      <Icon
        name={tab.icon}
        size={24}
        strokeWidth={isActive ? 2.4 : 2}
        className="producer-bottom-nav__icon"
      />
      <span
        className="producer-bottom-nav__label"
        style={{
          fontSize: 11,
          fontWeight: isActive ? 700 : 500,
          letterSpacing: "-0.005em",
        }}
      >
        {tab.label}
      </span>
    </>
  );
}

export function ProducerBottomNav(): ReactNode {
  const pathname = usePathname();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const active = getActiveKey(pathname);
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
  const offlineGestureNoticeShownRef = useRef(false);
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
      target.setAttribute(
        RUNTIME_MAIN_NAVIGATION_RELEASE_GUARD_UNTIL_ATTRIBUTE,
        String(deadline),
      );
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
    offlineGestureNoticeShownRef.current = false;
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
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-producer-nav-tab]")
        : null;
    crossedDestinationRef.current = pressedTabRef.current?.dataset.skNavDestination ?? null;
    navigatedTabRef.current = null;
    gestureIntentRef.current = "pending";
    offlineGestureNoticeShownRef.current = false;
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
        // An earlier offline crossing can arm the release guard while the
        // pointer is still held. Clear it before the next intentional live
        // crossing so reversal remains immediate.
        clearReleaseClickGuard();
        liveDragClickRef.current = true;
        try {
          destinationTab.click();
        } finally {
          liveDragClickRef.current = false;
          // Re-arm suppression so the browser's physical post-drag click
          // cannot navigate a second time, even when it reports detail=0.
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
    // Touch and pen start with implicit capture on the pressed Link.
    // Transferring a horizontal drag to the nav can bubble that child's
    // lost-capture event; only loss owned by the nav ends the gesture.
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
  }, [active]);

  return (
    <div
      // Keep the established shell-footer anchoring from SK-86: the
      // nav stays attached to the fixed app viewport without relying
      // on document-level `position: fixed`. This transparent frame
      // keeps the compact glass above the bottom safe area.
      className="producer-bottom-nav-frame relative z-30 shrink-0 lg:hidden"
      style={{
        padding:
          "0 max(12px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
      }}
    >
      <nav
        ref={navRef}
        role="navigation"
        aria-label="Producer tabs"
        data-interacting="false"
        data-lens-ready="false"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerLeave={handlePointerLeave}
        className="producer-bottom-nav__glass mx-auto grid w-full max-w-[420px] grid-cols-5"
      >
        <span className="producer-bottom-nav__lens" aria-hidden="true" />
        <span className="producer-bottom-nav__magnifier" aria-hidden="true">
          <span className="producer-bottom-nav__magnifier-grid">
            {PROD_TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <span
                  key={tab.id}
                  data-active={isActive ? "true" : "false"}
                  data-producer-nav-magnified-tab=""
                  className="producer-bottom-nav__magnified-tab flex min-w-0 flex-col items-center justify-center gap-1 py-2.5"
                  style={{
                    minHeight: 68,
                    color: isActive
                      ? "rgb(var(--brand-primary))"
                      : "rgb(var(--fg-onsidebar) / 0.68)",
                  }}
                >
                  <ProducerTabVisual tab={tab} isActive={isActive} />
                </span>
              );
            })}
          </span>
        </span>

        {PROD_TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              draggable={false}
              data-sk-nav-destination={tab.href}
              prefetch={true}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  clearReleaseClickGuard();
                }
              }}
              onNavigate={() => {
                announceRuntimeMainNavigationIntent(tab.href);
              }}
              aria-disabled={!online}
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
                captureRuntimeMainNavigationTarget(event.currentTarget);
                if (online) return;
                event.preventDefault();
                if (isLiveDragClick) {
                  armReleaseClickGuard();
                  if (!offlineGestureNoticeShownRef.current) {
                    offlineGestureNoticeShownRef.current = true;
                    toast(
                      "You’re offline. This screen will stay open until you reconnect.",
                      "error",
                    );
                  }
                } else {
                  if (navRef.current) settleLens(navRef.current);
                  toast(
                    "You’re offline. This screen will stay open until you reconnect.",
                    "error",
                  );
                }
              }}
              {...(isActive ? { "aria-current": "page" as const } : {})}
              data-active={isActive ? "true" : "false"}
              data-producer-nav-tab=""
              className="producer-bottom-nav__tab sk-press relative flex min-w-0 flex-col items-center justify-center gap-1 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                minHeight: 68,
                color: isActive ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.68)",
              }}
            >
              <ProducerTabVisual tab={tab} isActive={isActive} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
