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
// Visual: one floating Liquid Glass pill with an amber active lens.
// The glass paints through the iOS safe area while its 68px tab row
// stays above the Home Indicator, avoiding a detached blank footer.
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

type LensPoint = {
  clientX: number;
  clientY: number;
};

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
  const suppressClickRef = useRef(false);
  const lensFrameRef = useRef<number | null>(null);
  const settleFrameRef = useRef<number | null>(null);

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
    navRectRef.current = null;
    activePointerIdRef.current = null;
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
    suppressClickRef.current = false;
    nav.dataset.interacting = "true";
    setLensFromPointer(nav, navRectRef.current, event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const start = pointerStartRef.current;
    if (
      start &&
      Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP
    ) {
      suppressClickRef.current = true;
    }
    queueLensPoint(event);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const start = pointerStartRef.current;
    const moved =
      !start || Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > TAP_SLOP;
    const isTap = event.type === "pointerup" && !moved && !suppressClickRef.current;
    const destinationTab = isTap ? pressedTabRef.current : null;
    suppressClickRef.current ||= !isTap;
    settleLens(event.currentTarget, destinationTab);
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "mouse" || activePointerIdRef.current !== event.pointerId) return;
    settleLens(event.currentTarget);
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
      // on document-level `position: fixed`. Only this transparent
      // frame occupies the bottom safe area.
      className="producer-bottom-nav-frame relative z-30 shrink-0 lg:hidden"
      style={{
        padding:
          "0 max(12px, env(safe-area-inset-right, 0px)) 8px max(12px, env(safe-area-inset-left, 0px))",
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
        onLostPointerCapture={handlePointerEnd}
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
              data-sk-nav-destination={tab.href}
              prefetch={false}
              onNavigate={() => {
                announceRuntimeMainNavigationIntent(tab.href);
              }}
              aria-disabled={!online}
              onClick={(event) => {
                if (suppressClickRef.current && event.detail !== 0) {
                  event.preventDefault();
                  suppressClickRef.current = false;
                  if (navRef.current) settleLens(navRef.current);
                  return;
                }
                suppressClickRef.current = false;
                captureRuntimeMainNavigationTarget(event.currentTarget);
                if (online) return;
                event.preventDefault();
                if (navRef.current) settleLens(navRef.current);
                toast("You’re offline. This screen will stay open until you reconnect.", "error");
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
