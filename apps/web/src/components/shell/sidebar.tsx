"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

import type { ShellNotificationItem } from "~/server/shell-data";

import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";

// Left-rail sidebar, Linear/Splice-flavoured. Persists collapsed state
// to localStorage so it survives reloads. Listens for a custom
// `skitza:toggle-sidebar` event the shortcut layer dispatches on `[` —
// this keeps the hook decoupled from sidebar internals. Mobile gets
// a hamburger and an overlay drawer; desktop gets a 56↔240 rail.
//
// Flash-of-wrong-width: on SSR we don't know the user's preference,
// so we always render expanded first, then the mount effect nudges
// to collapsed if stored. 200ms transition smooths the change.

export type ActiveKey = "today" | "music" | "projects" | "setup";

type NavItem = { id: ActiveKey; label: string; href: string; icon: ReactNode };

const STORAGE_KEY = "skitza-sidebar-collapsed";

// Four-screen producer dashboard: Today (the daily dashboard),
// Music (library/catalog of audio), Projects (where work lives —
// contracts, booking, files all roll up per-project), Setup
// (portfolio + settings + account). "Project Room" is *not* a
// top-level item — it's always reached by tapping a project in
// the Projects list, so it's per-project not a global nav.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "today", label: "Today", href: "/dashboard", icon: <HomeIcon /> },
  { id: "music", label: "Music", href: "/dashboard/music", icon: <LibraryIcon /> },
  { id: "projects", label: "Projects", href: "/dashboard/projects", icon: <PortfolioIcon /> },
  { id: "setup", label: "Setup", href: "/dashboard/settings", icon: <SettingsIcon /> },
] as const;

export function Sidebar({
  active,
  producerSlug,
  unreadCount = 0,
  unreadItems = [],
}: {
  active: ActiveKey;
  producerSlug: string | null;
  unreadCount?: number;
  unreadItems?: readonly ShellNotificationItem[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
    <>
      {/* Mobile hamburger — fixed top-left, never shown on md+ */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => {
          setMobileOpen(true);
        }}
        className="fixed left-3 top-3 z-40 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2 text-[rgb(var(--fg-primary))] md:hidden"
      >
        <HamburgerIcon />
      </button>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => {
              setMobileOpen(false);
            }}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative h-full w-64 border-r border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
            <SidebarBody
              active={active}
              collapsed={false}
              producerSlug={producerSlug}
              unreadCount={unreadCount}
              unreadItems={unreadItems}
              onItemClick={() => {
                setMobileOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`${widthClass} sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] transition-[width] duration-200 md:flex`}
        data-collapsed={effectiveCollapsed}
      >
        <SidebarBody
          active={active}
          collapsed={effectiveCollapsed}
          producerSlug={producerSlug}
          unreadCount={unreadCount}
          unreadItems={unreadItems}
          onToggle={toggle}
        />
      </aside>
    </>
  );
}

function SidebarBody({
  active,
  collapsed,
  producerSlug,
  unreadCount,
  unreadItems,
  onToggle,
  onItemClick,
}: {
  active: ActiveKey;
  collapsed: boolean;
  producerSlug: string | null;
  unreadCount: number;
  unreadItems: readonly ShellNotificationItem[];
  onToggle?: () => void;
  onItemClick?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 p-3">
        <Link
          href="/dashboard"
          {...(onItemClick ? { onClick: onItemClick } : {})}
          className="flex items-center gap-2 font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
        >
          <SkitzaMark />
          {!collapsed && <span>Skitza</span>}
        </Link>
        {onToggle && (
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggle}
            className="rounded-md p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
          >
            <ChevronIcon flipped={collapsed} />
          </button>
        )}
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            collapsed={collapsed}
            badgeCount={item.id === "today" ? unreadCount : 0}
            {...(onItemClick ? { onClick: onItemClick } : {})}
          />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t border-[rgb(var(--border-subtle))] p-2">
        {producerSlug && !collapsed ? (
          <Link
            href={`/p/${producerSlug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))]"
          >
            Public profile →
          </Link>
        ) : null}
        <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "justify-between"} px-1`}>
          <div className={`flex items-center ${collapsed ? "flex-col" : ""} gap-1`}>
            <ThemeToggle />
            <NotificationBell unreadCount={unreadCount} unreadItems={unreadItems} />
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
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  badgeCount: number;
  onClick?: () => void;
}) {
  // Cap large counts visually so a thousand-comment neglected account
  // doesn't break the rail layout. Matches the Superhuman/Gmail pattern.
  const badgeLabel = badgeCount > 99 ? "99+" : badgeCount.toString();
  return (
    <Link
      href={item.href}
      {...(onClick ? { onClick } : {})}
      {...(isActive ? { "aria-current": "page" as const } : {})}
      {...(collapsed ? { title: item.label } : {})}
      className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
        isActive
          ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-primary))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      <span className="relative shrink-0">
        {item.icon}
        {collapsed && badgeCount > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))] ring-2 ring-[rgb(var(--bg-elevated))]"
          />
        ) : null}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {badgeCount > 0 ? (
            <span
              aria-label={`${badgeCount.toString()} unread`}
              className="ml-auto rounded-full bg-[rgb(var(--brand-primary))] px-1.5 py-[1px] font-mono text-[0.625rem] font-semibold text-[rgb(var(--fg-inverse))]"
            >
              {badgeLabel}
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

function SettingsIcon() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.3-1.7.6a5 5 0 0 0-1.8-1L9.3 1.5H6.7l-.2 1.7a5 5 0 0 0-1.8 1l-1.7-.6L1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.3 1.7-.6a5 5 0 0 0 1.8 1l.2 1.7h2.6l.2-1.7a5 5 0 0 0 1.8-1l1.7.6 1.3-2.3L12.9 9a5 5 0 0 0 .1-1Z" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M2.5 5h13M2.5 9h13M2.5 13h13" />
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
      className={`transition-transform ${flipped ? "rotate-180" : ""}`}
    >
      <path d="M9 3.5 4.5 7 9 10.5" />
    </svg>
  );
}
