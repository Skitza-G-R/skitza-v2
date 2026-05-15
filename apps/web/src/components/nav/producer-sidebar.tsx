"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";
import type { ShellNotificationItem } from "~/server/shell-data";

import { LanguageSwitcher } from "~/components/shell/language-switcher";
import { NotificationBell } from "~/components/shell/notification-bell";
import { SidebarShareChip } from "~/components/shell/sidebar-share-chip";
import { ThemeToggle } from "~/components/shell/theme-toggle";

import { Icon, type IconName } from "./icons";
import { Wordmark } from "./wordmark";

// ─── Producer left rail (desktop, lg+) ──────────────────────────────
//
// New Phase 2 design — ports notes/shell.jsx + shell.producer.jsx
// (locked design system) into the codebase. Replaces the prior
// light-surface Sidebar visually:
//   - Dark `--bg-sidebar` (#111009) chrome.
//   - 232px wide expanded, 64px collapsed (locked spec).
//   - Skitza wordmark with the amber period interaction.
//   - 6 nav items wired to the actual producer routes (per CLAUDE.md
//     §"Producer platform — 6 pages"); labels updated to match the
//     locked design (Overview/Projects/Music/Calendar/Store/Settings).
//   - Active state: 3px brand-primary bar on the leading edge of the
//     active row + 700-weight label + faint white glaze.
//
// Functionality preserved from the prior Sidebar:
//   - Collapse state + localStorage persistence + `[` shortcut event.
//   - `getActiveKey(usePathname())` URL-derived active state.
//   - i18n via `useTranslations("sidebar")`.
//   - Notification bell, theme toggle, language switcher, share chip,
//     and Clerk `<UserButton>` all mount in the bottom block — same
//     widgets, dark-themed surrounds.
//
// Functionality intentionally deferred to Phase 4 (per the Phase 2
// brief): the in-rail search button reads ⌘K but is currently a
// no-op; CommandPalette wiring lands when there's real data to
// search (projects, songs, clients).

// Internal IDs are stable per `~/lib/dashboard/active-key` so callers
// keep working — the labels + shortcuts surface the new design.
type NavItem = {
  id: ActiveKey;
  /** English source-of-truth label. Surfaced as a fallback when
   *  next-intl hasn't hydrated yet. Runtime label uses `labelKey` via
   *  useTranslations. */
  label: string;
  /** Translation key under `sidebar.*` — matches ActiveKey by design. */
  labelKey: ActiveKey;
  href: string;
  icon: IconName;
  /** Two-key G-leader shortcut surfaced on hover/focus. */
  shortcut: string;
};

const STORAGE_KEY = "skitza-sidebar-collapsed";

// 6-item producer nav, in the order the locked design specifies:
// Overview → Clients & Projects → Music → Calendar → Store → Settings.
// Labels mapped to actual routes per Gili's Phase 2 brief Q3 — no
// /dashboard/insights route exists, so Insights is intentionally
// omitted (linking to it would 404).
//
// G-leader shortcuts mirror the locked-design `ShortcutsHelp` panel
// (notes/nav.jsx): G H = Overview, G P = Projects, G M = Music,
// G C = Calendar, G S = Storefront, G T = Settings.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "today", label: "Overview", labelKey: "today", href: "/dashboard", icon: "home", shortcut: "G H" },
  { id: "clients-projects", label: "Clients & Projects", labelKey: "clients-projects", href: "/dashboard/clients-projects", icon: "users", shortcut: "G P" },
  { id: "music", label: "Music", labelKey: "music", href: "/dashboard/music", icon: "music", shortcut: "G M" },
  { id: "calendar", label: "Calendar", labelKey: "calendar", href: "/dashboard/calendar", icon: "calendar", shortcut: "G C" },
  { id: "profile", label: "Store", labelKey: "profile", href: "/dashboard/store", icon: "store", shortcut: "G S" },
  { id: "portfolio", label: "Portfolio", labelKey: "portfolio", href: "/dashboard/portfolio", icon: "book", shortcut: "G B" },
  { id: "setup", label: "Settings", labelKey: "setup", href: "/dashboard/settings", icon: "settings", shortcut: "G T" },
] as const;

export function ProducerSidebar({
  producerSlug,
  publicBaseUrl,
  unreadCount = 0,
  unreadItems = [],
}: {
  producerSlug: string | null;
  publicBaseUrl: string;
  unreadCount?: number;
  unreadItems?: readonly ShellNotificationItem[];
}): ReactNode {
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
      // localStorage can throw in private mode — fall back to expanded.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      } catch {
        // Silently ignore — state still updates in-memory.
      }
      return next;
    });
  }, []);

  // Listen for the `[` keyboard shortcut dispatched by the global
  // shortcuts bridge (~/components/shell/shortcuts-bridge).
  useEffect(() => {
    function onToggle() {
      toggle();
    }
    window.addEventListener("skitza:toggle-sidebar", onToggle);
    return () => {
      window.removeEventListener("skitza:toggle-sidebar", onToggle);
    };
  }, [toggle]);

  const effectiveCollapsed = mounted ? collapsed : false;
  const widthPx = effectiveCollapsed ? 64 : 232;

  // Desktop-only chrome — gated `hidden lg:flex` per Gili's Phase 2 Q1
  // (lg = 1024px is the canonical mobile/desktop split for Skitza).
  return (
    <aside
      data-collapsed={effectiveCollapsed}
      // RTL — `border-e` is the logical alias for the trailing border.
      // `sk-sidebar-shell` carries the drawer-curve width transition
      // (see globals.css) so the collapse/expand reads as a drawer
      // sliding rather than a generic resize.
      className="sk-sidebar-shell sticky top-0 hidden h-dvh shrink-0 flex-col border-e lg:flex"
      style={{
        width: widthPx,
        background: "rgb(var(--bg-sidebar))",
        color: "rgb(var(--fg-onsidebar))",
        borderInlineEndColor: "rgb(var(--border-sidebar))",
        boxShadow: "4px 0 24px rgba(17,16,9,0.08)",
        zIndex: 20,
      }}
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
  onToggle: () => void;
}) {
  const t = useTranslations("sidebar");
  return (
    <div className="flex h-full flex-col">
      {/* Wordmark + collapse/expand toggle.
          Expanded: wordmark + chevron-left side-by-side.
          Collapsed (64px): "S" logo above a chevron-right toggle, both
          centered. The toggle stays mounted in both states so users
          can always reverse the action — the `[` shortcut is a bonus,
          not the only way back. */}
      <div
        className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-center justify-between"}`}
        style={{ padding: collapsed ? "20px 8px 14px" : "20px 18px 14px" }}
      >
        <Link
          href="/dashboard"
          aria-label="Skitza dashboard home"
          className="sk-press flex items-center"
        >
          {collapsed ? (
            <span
              className="skitza-wordmark"
              style={{ fontSize: 18, color: "rgb(var(--fg-onsidebar))" }}
              aria-hidden
            >
              <span
                className="dot"
                style={{ color: "rgb(var(--brand-primary))" }}
              >
                S
              </span>
            </span>
          ) : (
            <Wordmark size={22} inverse />
          )}
        </Link>
        <button
          type="button"
          aria-label={collapsed ? t("expand") : t("collapse")}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="sk-press flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--fg-onsidebar)/0.55)] hover:bg-[rgb(var(--fg-onsidebar)/0.08)] hover:text-[rgb(var(--fg-onsidebar)/0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          {/* Single chevron rotating 180° between states — same arrow,
              reversed direction. Reads as continuity instead of a swap. */}
          <span
            className="sk-sidebar-chevron inline-flex"
            style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
          >
            <Icon name="chevron-left" size={14} strokeWidth={2.2} />
          </span>
        </button>
      </div>

      {/* Nav rail */}
      <nav
        aria-label="Primary"
        data-tour-id="sidebar-nav"
        className="custom-scrollbar flex flex-1 flex-col overflow-y-auto"
        style={{ padding: collapsed ? "4px 8px" : "4px 12px", gap: 2 }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            collapsed={collapsed}
            badgeCount={item.id === "today" ? unreadCount : 0}
            label={t(item.labelKey)}
          />
        ))}
      </nav>

      {/* Bottom block — widgets cluster + Clerk UserButton.
          Phase 2: the existing widgets (NotificationBell, ThemeToggle,
          LanguageSwitcher, SidebarShareChip) stay mounted so producers
          can still toggle theme + see notifications + share their
          link. They were styled for the prior light-surface sidebar —
          some visual mismatch is expected and intentional per the
          Phase 2 brief ("Pages inside will visually mismatch the new
          shells"). Phase 3 will redesign each widget to fit the dark
          rail. */}
      <div
        className="flex flex-col gap-2"
        style={{
          padding: collapsed ? "8px" : "12px",
          borderTop: "1px solid rgb(var(--border-sidebar))",
        }}
      >
        {!collapsed && (
          <SidebarShareChip
            producerSlug={producerSlug}
            collapsed={false}
            publicBaseUrl={publicBaseUrl}
          />
        )}
        <div
          className={`flex items-center ${collapsed ? "flex-col gap-2" : "justify-between"} px-1`}
        >
          <div className={`flex items-center ${collapsed ? "flex-col" : ""} gap-1`}>
            <ThemeToggle />
            <NotificationBell unreadCount={unreadCount} unreadItems={unreadItems} />
            <LanguageSwitcher collapsed={collapsed} />
          </div>
          <UserButton
            appearance={{
              elements: {
                avatarBox:
                  "h-7 w-7 ring-1 ring-[rgb(var(--border-sidebar))]",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

function NavItem({
  item,
  isActive,
  collapsed,
  badgeCount,
  label,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  badgeCount: number;
  label: string;
}) {
  const badgeLabel = badgeCount > 99 ? "99+" : badgeCount.toString();
  return (
    <Link
      href={item.href}
      data-tour-id={`nav-${item.id}`}
      {...(isActive ? { "aria-current": "page" as const } : {})}
      {...(collapsed ? { title: label } : {})}
      className="sk-press relative flex items-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
      style={{
        gap: collapsed ? 0 : 12,
        padding: collapsed ? "11px 10px" : "10px 12px",
        color: isActive
          ? "rgb(var(--fg-onsidebar))"
          : "rgb(var(--fg-onsidebar) / 0.55)",
        background: isActive
          ? "rgb(var(--fg-onsidebar) / 0.06)"
          : "transparent",
        fontSize: 13.5,
        fontWeight: isActive ? 700 : 500,
        letterSpacing: "-0.005em",
        justifyContent: collapsed ? "center" : "flex-start",
        minHeight: 36,
      }}
    >
      {/* Active indicator — 3px amber bar on leading edge.
          Always mounted, fades via opacity (sk-sidebar-active-bar) so
          the bar handoff on route change is smooth instead of a hard
          pop-in. */}
      <span
        aria-hidden
        className="sk-sidebar-active-bar pointer-events-none absolute"
        style={{
          insetInlineStart: -5,
          top: 8,
          bottom: 8,
          width: 3,
          borderRadius: 2,
          background: "rgb(var(--brand-primary))",
          opacity: isActive ? 1 : 0,
        }}
      />
      <span className="relative shrink-0 flex items-center">
        <Icon name={item.icon} size={16} strokeWidth={2.3} />
        {collapsed && badgeCount > 0 && (
          <span
            aria-hidden
            className="absolute"
            style={{
              insetInlineEnd: -4,
              top: -4,
              height: 8,
              width: 8,
              borderRadius: 999,
              background: "rgb(var(--brand-primary))",
              boxShadow: "0 0 0 2px rgb(var(--bg-sidebar))",
            }}
          />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badgeCount > 0 && (
            <span
              aria-label={`${badgeCount.toString()} unread`}
              className="font-mono"
              style={{
                marginInlineStart: "auto",
                background: "rgb(var(--brand-primary))",
                color: "rgb(var(--bg-sidebar))",
                fontSize: "0.625rem",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 999,
                lineHeight: 1.4,
              }}
            >
              {badgeLabel}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
