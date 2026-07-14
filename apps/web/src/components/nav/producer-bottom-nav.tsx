"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";

import { Icon, type IconName } from "./icons";

// ─── Producer mobile bottom nav (<lg) ───────────────────────────────
//
// Replaces the prior light-surface MobileBottomNav (with its centre
// "+" FAB) with the locked design's dark 5-tab bar. Per CLAUDE.md the
// producer surface was historically desktop-only; Raz approved mobile
// producer for v1 (2026-05-05), so this nav is the producer's mobile
// chrome.
//
// Visual: dark `--bg-sidebar` background, amber active-tab colour,
// 5-column grid. No FAB — the design intentionally simplifies to
// match the artist nav grammar.
//
// Routes are mapped per Gili's Phase 2 Q3 — six top-level routes
// reduced to 5 mobile tabs by collapsing Settings under the "Account"
// menu accessed elsewhere (kept reachable via /dashboard/settings on
// desktop and via Clerk UserButton in the mobile top bar). The mobile
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
  { id: "today", label: "Home", href: "/dashboard", icon: "home" },
  { id: "clients-projects", label: "Clients", href: "/dashboard/clients-projects", icon: "users" },
  { id: "music", label: "Library", href: "/dashboard/music", icon: "music" },
  // SK-56: phones land on the Sessions tab — the week-grid Schedule
  // tab is desktop-only (useless at 390px, per Gili's mobile audit).
  // Active-state detection is pathname-based, so the query is inert.
  { id: "calendar", label: "Calendar", href: "/dashboard/calendar?tab=sessions", icon: "calendar" },
  { id: "profile", label: "Store", href: "/dashboard/store", icon: "store" },
] as const;

export function visualViewportDockTop({
  viewportOffsetTop,
  viewportHeight,
  dockHeight,
}: {
  viewportOffsetTop: number;
  viewportHeight: number;
  dockHeight: number;
}): number {
  return Math.max(0, viewportOffsetTop + viewportHeight - dockHeight);
}

export function ProducerBottomNav(): ReactNode {
  const pathname = usePathname();
  const active = getActiveKey(pathname);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const viewport = window.visualViewport;
    if (!nav || !viewport) return;

    let frame = 0;
    const updatePosition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        nav.style.bottom = "auto";
        nav.style.top = `${String(
          visualViewportDockTop({
            viewportOffsetTop: viewport.offsetTop,
            viewportHeight: viewport.height,
            dockHeight: nav.offsetHeight,
          }),
        )}px`;
      });
    };

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(nav);
    viewport.addEventListener("resize", updatePosition);
    viewport.addEventListener("scroll", updatePosition);
    window.addEventListener("orientationchange", updatePosition);
    updatePosition();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewport.removeEventListener("resize", updatePosition);
      viewport.removeEventListener("scroll", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
      nav.style.removeProperty("bottom");
      nav.style.removeProperty("top");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      role="navigation"
      aria-label="Producer tabs"
      // The padding includes the iOS safe-area insets so labels clear
      // the home indicator and landscape sensor housing.
      // `lg:hidden` — desktop renders the left rail instead.
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden"
      style={{
        background: "rgb(var(--bg-sidebar))",
        borderTop: "1px solid rgb(var(--border-sidebar))",
        padding:
          "6px calc(4px + env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) calc(4px + env(safe-area-inset-left, 0px))",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}
    >
      {PROD_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            {...(isActive ? { "aria-current": "page" as const } : {})}
            className="sk-press relative flex flex-col items-center gap-0.5 rounded-md py-2 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
            style={{
              flex: 1,
              minHeight: 56,
              color: isActive ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.55)",
            }}
          >
            <Icon name={tab.icon} size={20} strokeWidth={isActive ? 2.4 : 2} />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: isActive ? 700 : 500,
                letterSpacing: "-0.005em",
              }}
            >
              {tab.label}
            </span>
            {isActive && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: -6,
                  width: 26,
                  height: 2,
                  borderRadius: 2,
                  background: "rgb(var(--brand-primary))",
                }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
