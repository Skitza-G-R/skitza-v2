"use client";

import { AppTopBar } from "./app-topbar";

// Producer-side wrapper around the shared `AppTopBar`. Owns nothing
// heavy — just the producer's section label map, the search
// placeholder copy that's specific to producer content, and the
// click handler that opens the producer command palette.

const PRODUCER_SECTIONS = {
  "/dashboard": "Overview",
  "/dashboard/clients-projects": "Clients & Projects",
  "/dashboard/music": "Music",
  "/dashboard/calendar": "Calendar",
  "/dashboard/profile": "Storefront",
  "/dashboard/store": "Store",
  "/dashboard/settings": "Settings",
} as const;

const PRODUCER_FALLBACK = { path: "/dashboard", label: "Dashboard" };

// Reuses the same custom event ⌘K dispatches via CommandPaletteTrigger
// — one search surface, one open mechanism, regardless of entry point.
function openProducerPalette() {
  window.dispatchEvent(new CustomEvent("skitza:open-palette"));
}

interface DashboardTopBarProps {
  /** Unread notification count for the bell dot. */
  unreadCount?: number;
}

export function DashboardTopBar({ unreadCount = 0 }: DashboardTopBarProps) {
  return (
    <AppTopBar
      sections={PRODUCER_SECTIONS}
      fallback={PRODUCER_FALLBACK}
      searchPlaceholder="Search projects, clients, songs…"
      onSearchClick={openProducerPalette}
      unreadCount={unreadCount}
    />
  );
}
