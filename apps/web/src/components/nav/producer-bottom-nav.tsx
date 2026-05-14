"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
  { id: "calendar", label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
  { id: "profile", label: "Store", href: "/dashboard/store", icon: "store" },
  { id: "portfolio", label: "Portfolio", href: "/dashboard/portfolio", icon: "book" },
] as const;

export function ProducerBottomNav(): ReactNode {
  const pathname = usePathname();
  const active = getActiveKey(pathname);

  return (
    <nav
      role="navigation"
      aria-label="Producer tabs"
      // `sk-safe-bottom` pads the iOS home-indicator inset inside the
      // bar so labels clear the gesture strip on iPhone PWAs.
      // `lg:hidden` — desktop renders the left rail instead.
      className="sk-safe-bottom sk-safe-x fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden"
      style={{
        background: "rgb(var(--bg-sidebar))",
        borderTop: "1px solid rgb(var(--border-sidebar))",
        padding: "6px 4px 0",
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
            className="sk-press relative flex flex-col items-center gap-0.5 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
            style={{
              flex: 1,
              minHeight: 56,
              color: isActive
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--fg-onsidebar) / 0.55)",
            }}
          >
            <Icon
              name={tab.icon}
              size={20}
              strokeWidth={isActive ? 2.4 : 2}
            />
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
