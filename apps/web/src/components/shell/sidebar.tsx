"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";
import { tokenizeShortcut } from "~/components/ui/keyboard-hint";
import type { ShellNotificationItem } from "~/server/shell-data";

import { LanguageSwitcher } from "./language-switcher";
import { NotificationBell } from "./notification-bell";
import { SidebarShareChip } from "./sidebar-share-chip";
import { ThemeToggle } from "./theme-toggle";

// Left-rail sidebar, Linear/Splice-flavoured. Persists collapsed state
// to localStorage so it survives reloads. Listens for a custom
// `skitza:toggle-sidebar` event the shortcut layer dispatches on `[` —
// this keeps the hook decoupled from sidebar internals. Mobile is
// served by MobileBottomNav (see ~/components/shell/mobile-bottom-nav);
// this component is desktop-only (`md:flex hidden`) and renders a
// 56↔240 rail. The old hamburger + overlay-drawer was retired when
// the bottom nav landed — same 4 entry points, no second surface.
//
// Flash-of-wrong-width: on SSR we don't know the user's preference,
// so we always render expanded first, then the mount effect nudges
// to collapsed if stored. 200ms transition smooths the change.
//
// `ActiveKey` lives in `~/lib/dashboard/active-key` (a plain TS
// module — no `"use client"`) so it stays importable from server
// components if a future page-title helper needs it. Sidebar
// re-uses `getActiveKey()` from there to derive the active nav key
// from the current URL, replacing the old `active` prop.

type NavItem = {
  id: ActiveKey;
  /** English source-of-truth label. Retained for tests + as the
   *  fallback when next-intl hasn't hydrated yet. Runtime rendering
   *  uses `labelKey` via `useTranslations("sidebar")`. */
  label: string;
  /** Translation key under `sidebar.*` — matches ActiveKey by design. */
  labelKey: ActiveKey;
  href: string;
  icon: ReactNode;
  /** Two-key G-leader shortcut (e.g. "G T" for Today). */
  shortcut: string;
};

const STORAGE_KEY = "skitza-sidebar-collapsed";

// Six-page producer dashboard (PRD §4): Today, Clients & Projects,
// Music, Calendar, Profile, Setup. Profile + Calendar landed in
// P2-A-7 as Phase-3 stubs — the routes exist so the rail surfaces
// the full producer surface without 404s. "Project Room" is *not*
// a top-level item — it's always reached by tapping a project in
// the Clients & Projects list.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "today", label: "Today", labelKey: "today", href: "/dashboard", icon: <HomeIcon />, shortcut: "G T" },
  { id: "clients-projects", label: "Clients & Projects", labelKey: "clients-projects", href: "/dashboard/clients-projects", icon: <PortfolioIcon />, shortcut: "G P" },
  { id: "music", label: "Music", labelKey: "music", href: "/dashboard/music", icon: <LibraryIcon />, shortcut: "G M" },
  { id: "calendar", label: "Calendar", labelKey: "calendar", href: "/dashboard/calendar", icon: <CalendarIcon />, shortcut: "G C" },
  { id: "profile", label: "Profile", labelKey: "profile", href: "/dashboard/profile", icon: <ProfileIcon />, shortcut: "G F" },
  { id: "setup", label: "Setup", labelKey: "setup", href: "/dashboard/settings", icon: <SettingsIcon />, shortcut: "G S" },
] as const;

export function Sidebar({
  producerSlug,
  publicBaseUrl,
  unreadCount = 0,
  unreadItems = [],
}: {
  producerSlug: string | null;
  /** Canonical site origin used by the SidebarShareChip to build the
   *  /join/<slug> URL. Threaded from app-shell — falls back to the
   *  same chain (`NEXT_PUBLIC_SITE_URL` → `SITE_URL` → "https://skitza.app")
   *  used by the prior Today hero ShareLinkCard. */
  publicBaseUrl: string;
  unreadCount?: number;
  unreadItems?: readonly ShellNotificationItem[];
}) {
  // Active nav key is derived from the current URL via the shared
  // helper. `getActiveKey` falls back to "today" for any unrecognised
  // path so the rail always has SOME active state — never a blank
  // segment. Replaces the old `active: ActiveKey` prop that every
  // dashboard page used to thread in by hand.
  const pathname = usePathname();
  const active: ActiveKey = getActiveKey(pathname);
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

  // Respond to the `[` shortcut dispatched by the global keymap.
  useEffect(() => {
    function onToggle() {
      toggle();
    }
    window.addEventListener("skitza:toggle-sidebar", onToggle);
    return () => {
      window.removeEventListener("skitza:toggle-sidebar", onToggle);
    };
  }, [toggle]);

  // SSR/pre-mount: always render expanded to avoid a flash of 56px on wide viewports.
  const effectiveCollapsed = mounted ? collapsed : false;
  const widthClass = effectiveCollapsed ? "w-14" : "w-60";

  return (
    <aside
      // RTL — sidebar rails against the page's trailing edge in RTL
      // (right → left flip puts it on the left), so the separator
      // needs to be on the logical END side. `border-e` is the logical
      // alias: `border-right` in LTR, `border-left` in RTL.
      className={`${widthClass} sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] transition-[width] duration-200 md:flex`}
      data-collapsed={effectiveCollapsed}
    >
      <SidebarBody
        active={active}
        collapsed={effectiveCollapsed}
        producerSlug={producerSlug}
        publicBaseUrl={publicBaseUrl}
        unreadCount={unreadCount}
        unreadItems={unreadItems}
        onToggle={toggle}
      />
    </aside>
  );
}

function SidebarBody({
  active,
  collapsed,
  producerSlug,
  publicBaseUrl,
  unreadCount,
  unreadItems,
  onToggle,
}: {
  active: ActiveKey;
  collapsed: boolean;
  producerSlug: string | null;
  publicBaseUrl: string;
  unreadCount: number;
  unreadItems: readonly ShellNotificationItem[];
  onToggle?: () => void;
}) {
  const t = useTranslations("sidebar");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          <SkitzaMark />
          {!collapsed && <span>Skitza</span>}
        </Link>
        {onToggle && (
          <button
            type="button"
            aria-label={collapsed ? t("expand") : t("collapse")}
            onClick={onToggle}
            // Desktop-only control (the desktop rail mounts SidebarBody
            // via onToggle); mouse precision means we can keep this at
            // a tight 28×28 without falling below the desktop target
            // floor. Adds focus-visible for keyboard.
            className="flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            <ChevronIcon flipped={collapsed} />
          </button>
        )}
      </div>
      <nav
        aria-label="Primary"
        data-tour-id="sidebar-nav"
        className="flex-1 space-y-0.5 px-2"
      >
        {NAV_ITEMS.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            collapsed={collapsed}
            badgeCount={item.id === "today" ? unreadCount : 0}
          />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] p-2">
        {/* Story 05 — share-link chip lives in the sidebar footer so
            it's reachable from every authenticated page (not just
            Today). Replaces the prior "Public profile →" Link. The
            chip handles its own missing-slug + collapsed-state
            variants — no conditional rendering needed here. */}
        <SidebarShareChip
          producerSlug={producerSlug}
          collapsed={collapsed}
          publicBaseUrl={publicBaseUrl}
        />
        <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "justify-between"} px-1`}>
          <div className={`flex items-center ${collapsed ? "flex-col" : ""} gap-1`}>
            <ThemeToggle />
            <NotificationBell unreadCount={unreadCount} unreadItems={unreadItems} />
            <LanguageSwitcher collapsed={collapsed} />
          </div>
          <UserButton
            appearance={{
              elements: { avatarBox: "h-7 w-7 ring-1 ring-[rgb(var(--border-subtle))]" },
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  item,
  isActive,
  collapsed,
  badgeCount,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  badgeCount: number;
}) {
  const t = useTranslations("sidebar");
  const label = t(item.labelKey);
  // Cap large counts visually so a thousand-comment neglected account
  // doesn't break the rail layout. Matches the Superhuman/Gmail pattern.
  const badgeLabel = badgeCount > 99 ? "99+" : badgeCount.toString();
  // Inline G-leader shortcut shows on hover/focus when:
  //   - sidebar is expanded (collapsed icon-only rail has no room)
  //   - row is NOT active (active brand-bar carries the orientation;
  //     redundant kbd would crowd the row)
  //   - row has NO unread badge (badge wins; the producer needs to
  //     see "3 unread" before "G T")
  // Replaces the prior portal-tooltip approach (KeyboardHint), which
  // computed an absolute-positioned floater off the row's bounding
  // rect — under the narrow sidebar gutter, the tooltip collided with
  // the adjacent row's text. Inline kbd lives inside the row's flow,
  // so collisions are impossible by construction.
  const showShortcut = !collapsed && !isActive && badgeCount === 0;
  return (
    <Link
      href={item.href}
      data-tour-id={`nav-${item.id}`}
      {...(isActive ? { "aria-current": "page" as const } : {})}
      {...(collapsed ? { title: label } : {})}
      // min-h-[44px] tap target (both mobile bottom-nav and the
      // collapsed desktop rail still target keyboard/touch users
      // here) → md:min-h-[36px] lets the collapsed desktop rail
      // breathe without ballooning the row. `title` on collapsed
      // gives a native hover tooltip so icons aren't guessing games.
      //
      // Active indicator: a 2px copper bar anchored to the left edge
      // via absolute positioning. Scale-Y transitions from 0 → 1 when
      // active, giving a subtle slide-in effect without the DOM cost
      // of a shared element (one bar per item, only one visible at a
      // time). `sk-trans` governs the hover colour + bar transition.
      // `group` lets descendant kbd toggle visibility on group-hover.
      className={`sk-trans group relative flex min-h-[44px] items-center gap-3 rounded-md px-2 py-2 text-sm md:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] ${
        isActive
          ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-primary))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      {/* RTL — the active-state indicator bar lives on the logical
          start edge. `start-0` is the logical-property equivalent of
          `left-0` under LTR + `right-0` under RTL, so Tailwind v4
          resolves it against the ambient `dir`. No JS needed. */}
      <span
        aria-hidden
        className={`sk-trans absolute start-0 top-1.5 bottom-1.5 w-[2px] origin-center rounded-full bg-[rgb(var(--brand-primary))] ${
          isActive ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0"
        }`}
      />
      <span className="relative shrink-0">
        {item.icon}
        {collapsed && badgeCount > 0 ? (
          // `-end-1` is the RTL-aware equivalent of the old `-right-1` —
          // the unread dot floats at the trailing edge of the icon
          // regardless of text direction.
          <span
            aria-hidden
            className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--bg-elevated))]"
          />
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badgeCount > 0 ? (
            // `ms-auto` (margin-start) pushes the badge to the trailing
            // edge in both directions — LTR: far right; RTL: far left.
            <span
              aria-label={`${badgeCount.toString()} unread`}
              className="ms-auto rounded-full bg-[rgb(var(--brand-primary))] px-1.5 py-[1px] font-mono text-[0.625rem] font-semibold text-[rgb(var(--fg-inverse))]"
            >
              {badgeLabel}
            </span>
          ) : null}
          {showShortcut ? (
            <span
              aria-hidden
              // ms-auto lands the chip at the trailing edge in both
              // directions; opacity-0 → group-hover/focus-within reveals
              // it. Uses sk-trans for a soft fade so the row doesn't
              // jolt when the cursor enters/leaves.
              className="sk-trans ms-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {tokenizeShortcut(item.shortcut).map((tok, i) => (
                <kbd
                  key={i}
                  className="rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1 py-0.5 font-mono text-[0.6rem] leading-none text-[rgb(var(--fg-muted))]"
                >
                  {tok}
                </kbd>
              ))}
            </span>
          ) : null}
        </>
      )}
    </Link>
  );
}

// -- Icons: inline SVGs, 16x16, stroke=currentColor. No icon library
// dependency — each one is a handful of paths. Keeps the bundle
// small and avoids a new dep just for six glyphs.

function SkitzaMark() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 28 28" className="shrink-0">
      <defs>
        <linearGradient id="sidebar-skitza-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-primary))" />
          <stop offset="100%" stopColor="rgb(var(--brand-accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--bg-elevated))" stroke="rgb(var(--border-strong))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="url(#sidebar-skitza-mark)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" fill="url(#sidebar-skitza-mark)" />
    </svg>
  );
}

// Home — a simple house silhouette for the "Today" daily-dashboard tab.
function HomeIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7.5 8 2l6 5.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5Z" />
      <path d="M6.5 14V9.5h3V14" />
    </svg>
  );
}

// Library — a stylised waveform block. Evokes "audio" without the
// saccharine music-note glyph. Four bars of varying heights inside
// the same 16x16 frame as our other icons. Reused as the Music icon.
function LibraryIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10V6" />
      <path d="M6 12V4" />
      <path d="M9 11V5" />
      <path d="M12 9V7" />
    </svg>
  );
}

// Portfolio / Projects — a folder-with-tab silhouette. Reused for
// the Projects top-level nav since a "project" is the folder that
// holds contracts, bookings, files, and comments per-client.
function PortfolioIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M5 3V1.75h6V3" />
      <path d="M1.5 8h13" />
    </svg>
  );
}

// Calendar — a simple grid silhouette: header bar (binding rings) +
// month box. Same 16x16 stroke pattern as the rest of the rail.
function CalendarIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3.5" width="12" height="11" rx="1.5" />
      <path d="M2 7h12" />
      <path d="M5.5 2v3" />
      <path d="M10.5 2v3" />
    </svg>
  );
}

// Profile — a head + shoulders silhouette. Used for the producer
// storefront / public-profile page (the conversion funnel surface).
function ProfileIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 13.5c0-2.2 2.2-4 5-4s5 1.8 5 4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.3-1.7.6a5 5 0 0 0-1.8-1L9.3 1.5H6.7l-.2 1.7a5 5 0 0 0-1.8 1l-1.7-.6L1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.3 1.7-.6a5 5 0 0 0 1.8 1l.2 1.7h2.6l.2-1.7a5 5 0 0 0 1.8-1l1.7.6 1.3-2.3L12.9 9a5 5 0 0 0 .1-1Z" />
    </svg>
  );
}

function ChevronIcon({ flipped }: { flipped: boolean }) {
  // RTL: the chevron is an SVG path that physically points "left" in
  // its natural orientation. Under LTR, `flipped` (= sidebar collapsed)
  // rotates it to point right. Under RTL, the sidebar is on the
  // leading side (the right edge), so the glyph needs to point the
  // opposite way in both states. Composing `rtl:rotate-180` gives us:
  //   LTR, expanded:   "<" (points toward content)
  //   LTR, collapsed:  ">" (points away, toward sidebar)
  //   RTL, expanded:   ">" (points toward content — LTR rotated 180)
  //   RTL, collapsed:  "<" (LTR collapsed + rtl rotation cancel to 0)
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
