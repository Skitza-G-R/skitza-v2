"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Icon, type IconName } from "./icons";

// ─── Artist mobile bottom nav (<lg) ─────────────────────────────────
//
// Replaces the prior emoji-based artist BottomNav with the locked
// design's dark 5-tab bar. Mirrors the producer mobile bar visually
// (same dark `--bg-sidebar` surface, amber active colour, 9.5px
// labels, top brand-bar indicator) so the two apps share grammar.
//
// Routes wired per CLAUDE.md §"Artist platform — 5 sections":
//   Home / Music / Book / Store / Settings
// "Messages" appears in the locked desktop design but no /artist/messages
// route exists — dropped for Phase 2 per Gili's same-pattern Q3 ruling
// (don't ship nav items that 404).
//
// Active-state derivation: exact match on /artist for Home, prefix
// match for everything else. Mirrors the prior bottom-nav semantics.

type ArtistTab = {
  href: string;
  label: string;
  icon: IconName;
};

const TABS: readonly ArtistTab[] = [
  { href: "/artist", label: "Home", icon: "home" },
  { href: "/artist/music", label: "Music", icon: "music" },
  { href: "/artist/book", label: "Book", icon: "book" },
  { href: "/artist/store", label: "Store", icon: "store" },
  { href: "/artist/settings", label: "Settings", icon: "settings" },
] as const;

export function ArtistBottomNav(): ReactNode {
  const pathname = usePathname();
  // "Home" is the only path that needs an exact match; the others
  // light up on any descendant route (e.g. /artist/music/abc123).
  const isActive = (href: string) =>
    href === "/artist" ? pathname === "/artist" : pathname.startsWith(href);

  return (
    <nav
      role="navigation"
      aria-label="Artist app tabs"
      className="sk-safe-bottom sk-safe-x fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden"
      style={{
        background: "rgb(var(--bg-sidebar))",
        borderTop: "1px solid rgb(var(--border-sidebar))",
        padding: "6px 4px 0",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}
    >
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            {...(active ? { "aria-current": "page" as const } : {})}
            className="sk-press relative flex flex-col items-center gap-0.5 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
            style={{
              flex: 1,
              minHeight: 56,
              color: active
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--fg-onsidebar) / 0.55)",
            }}
          >
            <Icon
              name={tab.icon}
              size={20}
              strokeWidth={active ? 2.4 : 2}
            />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: active ? 700 : 500,
                letterSpacing: "-0.005em",
              }}
            >
              {tab.label}
            </span>
            {active && (
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
