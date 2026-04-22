"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { LanguageSwitcher } from "~/components/shell/language-switcher";
import { ThemeToggle } from "~/components/shell/theme-toggle";
import type { Studio } from "~/server/artist/identity";

import { ArtistNotificationBell, type ArtistNotificationItem } from "./notification-bell";
import { StudioSwitcher } from "./studio-switcher";

// Desktop sidebar for the artist app. Mirrors the producer shell's
// sidebar pattern (collapsible rail, localStorage-persisted state,
// [` shortcut via custom window event) but with:
//   - artist-only nav (Home / Music / Book / Store)
//   - the Studio Switcher surfaced at the top (artists can belong to
//     multiple studios; producer side doesn't need this)
//   - artist-scoped Notification Bell + UserButton in the footer
//
// 2026-04-22 — Task 17 Phase 2 (docs/audit-report.md + design brief).
// Gili's answers to the design-brief §7 open questions:
//   Q1: "collapsible, like producer" → use the same `[`-shortcut +
//        localStorage pattern (but an independent STORAGE_KEY so
//        artist + producer collapse states don't fight).
//   Q2: "yes" notification bell → stub UI shipped now, real data in
//        a 2.5 follow-up PR.
//
// Hidden on mobile (`hidden md:flex`) — the mobile app keeps its
// existing header + bottom nav. The sidebar replaces BOTH header and
// bottom nav on desktop so the chrome feels native-desktop.

type ActiveKey = "home" | "music" | "book" | "store";

type NavItem = {
  id: ActiveKey;
  label: string;
  href: string;
  icon: ReactNode;
};

const STORAGE_KEY = "skitza-artist-sidebar-collapsed";

const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", label: "Home", href: "/artist", icon: <HomeIcon /> },
  { id: "music", label: "Music", href: "/artist/music", icon: <WaveformIcon /> },
  { id: "book", label: "Book", href: "/artist/book", icon: <CalendarIcon /> },
  { id: "store", label: "Store", href: "/artist/store", icon: <StoreIcon /> },
] as const;

// Active-tab detection mirrors the BottomNav's exact-match-for-home,
// startsWith-for-others behaviour so a navigate to /artist/music/<id>
// keeps "Music" lit.
function isActive(href: string, pathname: string): boolean {
  return href === "/artist" ? pathname === "/artist" : pathname.startsWith(href);
}

export function ArtistSidebar({
  studios,
  isProducer,
  unreadCount = 0,
  unreadItems = [],
}: {
  studios: Studio[];
  isProducer: boolean;
  unreadCount?: number;
  unreadItems?: readonly ArtistNotificationItem[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {
      // localStorage can throw in private-mode or if disabled — fall back to default (expanded).
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      } catch {
        // Silently ignore storage failures; state still updates in-memory.
      }
      return next;
    });
  }, []);

  // Respond to `[` shortcut dispatched by the global keymap — same
  // event name as the producer side, independent state. A user pressing
  // `[` on artist /desktop toggles this collapse; on producer /desktop
  // toggles that one. They don't interfere because only one is visible
  // at a time per route.
  useEffect(() => {
    function onToggle() {
      toggle();
    }
    window.addEventListener("skitza:toggle-sidebar", onToggle);
    return () => {
      window.removeEventListener("skitza:toggle-sidebar", onToggle);
    };
  }, [toggle]);

  // SSR/pre-mount: always render expanded to avoid a flash of 56px
  // on wide viewports when a user had collapsed persisted.
  const effectiveCollapsed = mounted ? collapsed : false;
  const widthClass = effectiveCollapsed ? "w-14" : "w-60";

  return (
    <aside
      // RTL-aware: `border-e` resolves to border-right (LTR) / border-left (RTL).
      className={`${widthClass} sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] transition-[width] duration-200 md:flex`}
      data-collapsed={effectiveCollapsed}
    >
      <div className="flex h-full flex-col">
        {/* Top: brand mark + collapse toggle */}
        <div className="flex items-center justify-between gap-2 p-3">
          <Link
            href="/artist"
            className="flex items-center gap-2 font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
          >
            <SkitzaMark />
            {!effectiveCollapsed && <span>Skitza</span>}
          </Link>
          <button
            type="button"
            aria-label={effectiveCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggle}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            <ChevronIcon flipped={effectiveCollapsed} />
          </button>
        </div>

        {/* Studio Switcher — artist-specific context, surfaced at top
            of nav. Expanded: shows "Studio" label + full dropdown.
            Collapsed: shows just the avatar as a clickable button
            (still opens the dropdown for multi-studio users), so an
            artist with 2+ studios can switch without expanding first.
            Fix for the Phase 2+3 audit's "StudioSwitcher disappears
            in collapsed sidebar" finding. */}
        <div className="border-b border-[rgb(var(--border-subtle))] px-3 pb-3">
          {!effectiveCollapsed && (
            <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              Studio
            </p>
          )}
          <StudioSwitcher studios={studios} compact={effectiveCollapsed} />
        </div>

        {/* Primary nav */}
        <nav
          aria-label="Primary"
          className="flex-1 space-y-0.5 px-2 py-3"
        >
          {NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              isActive={isActive(item.href, pathname)}
              collapsed={effectiveCollapsed}
            />
          ))}
        </nav>

        {/* Footer: theme toggle, language, notification bell, UserButton */}
        <div className="mt-auto flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] p-2">
          <div className={`flex items-center ${effectiveCollapsed ? "flex-col gap-2" : "justify-between"} px-1`}>
            <div className={`flex items-center ${effectiveCollapsed ? "flex-col" : ""} gap-1`}>
              <ThemeToggle />
              <ArtistNotificationBell
                unreadCount={unreadCount}
                unreadItems={unreadItems}
              />
              <LanguageSwitcher collapsed={effectiveCollapsed} />
            </div>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-7 w-7 ring-1 ring-[rgb(var(--border-subtle))]",
                },
              }}
            >
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Settings"
                  labelIcon={<SettingsMenuIcon />}
                  href="/artist/settings"
                />
                {isProducer ? (
                  <UserButton.Link
                    label="Producer dashboard"
                    labelIcon={<BackArrowIcon />}
                    href="/dashboard"
                  />
                ) : null}
              </UserButton.MenuItems>
            </UserButton>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  item,
  isActive,
  collapsed,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={item.href}
      {...(isActive ? { "aria-current": "page" as const } : {})}
      {...(collapsed ? { title: item.label } : {})}
      // min-h-[44px] tap target (keyboard/touch in collapsed rail).
      // Active indicator — a 2px copper bar anchored to the logical
      // start edge — matches the producer sidebar's idiom so a user
      // who toggles between the two feels the same shell.
      className={`sk-trans relative flex min-h-[44px] items-center gap-3 rounded-md px-2 py-2 text-sm md:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] ${
        isActive
          ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-primary))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      <span
        aria-hidden
        className={`sk-trans absolute start-0 top-1.5 bottom-1.5 w-[2px] origin-center rounded-full bg-[rgb(var(--brand-primary))] ${
          isActive ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0"
        }`}
      />
      <span className="relative shrink-0">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────
// Inline SVGs, 16×16, stroke=currentColor. Matches the producer
// sidebar's icon style so both apps feel like parts of the same
// product. Each one is a handful of paths — keeps the bundle lean
// without a new icon-library dep.

function SkitzaMark() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 28 28" className="shrink-0">
      <defs>
        <linearGradient id="artist-sidebar-skitza-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-primary))" />
          <stop offset="100%" stopColor="rgb(var(--brand-accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--bg-elevated))" stroke="rgb(var(--border-strong))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="url(#artist-sidebar-skitza-mark)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" fill="url(#artist-sidebar-skitza-mark)" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7.5 8 2l6 5.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5Z" />
      <path d="M6.5 14V9.5h3V14" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10V6" />
      <path d="M6 12V4" />
      <path d="M9 11V5" />
      <path d="M12 9V7" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12" />
      <path d="M5.5 1.5v3" />
      <path d="M10.5 1.5v3" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5 3.5 2h9l1 3" />
      <path d="M2.5 5v8.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V5" />
      <path d="M2.5 5h11" />
      <path d="M6 14V9h4v5" />
    </svg>
  );
}

function ChevronIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform rtl:rotate-180 ${flipped ? "rotate-180 rtl:rotate-0" : ""}`}
    >
      <path d="M9 3.5 4.5 7 9 10.5" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

// Small gear icon for the "Settings" UserButton menu item. 16px to
// match Clerk's default menu-item icon size.
function SettingsMenuIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.3-1.7.6a5 5 0 0 0-1.8-1L9.3 1.5H6.7l-.2 1.7a5 5 0 0 0-1.8 1l-1.7-.6L1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.3 1.7-.6a5 5 0 0 0 1.8 1l.2 1.7h2.6l.2-1.7a5 5 0 0 0 1.8-1l1.7.6 1.3-2.3L12.9 9a5 5 0 0 0 .1-1Z" />
    </svg>
  );
}
