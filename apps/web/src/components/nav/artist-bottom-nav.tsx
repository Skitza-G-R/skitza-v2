"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import { announceRuntimeMainNavigationIntent } from "~/lib/runtime-state/navigation-cache";
import type { Studio } from "~/server/artist/identity";

import { isArtistNavItemActive } from "./artist-nav-active";
import { Icon, type IconName } from "./icons";

// ─── Artist mobile bottom nav (<lg) ─────────────────────────────────
//
// Replaces the prior emoji-based artist BottomNav with the locked
// design's dark 5-tab bar. Mirrors the producer mobile bar visually
// (same dark `--bg-sidebar` surface, amber active colour, 11px
// labels, top brand-bar indicator) so the two apps share grammar.
//
// Routes wired per CLAUDE.md §"Artist platform — 5 sections":
//   Home / Music / Book / Store / Payments
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
  { href: "/artist/payments", label: "Payments", icon: "payments" },
] as const;

export function ArtistBottomNav({ studios }: { studios: Studio[] }): ReactNode {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStudioId = resolveArtistStudioId(studios, searchParams.get("studio"));
  // My Sessions belongs to the approved Book section even though its
  // route lives at /artist/sessions.
  const isActive = (href: string) => isArtistNavItemActive(pathname, href);

  return (
    <nav
      role="navigation"
      aria-label="Artist app tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden"
      style={{
        background: "rgb(var(--bg-sidebar))",
        borderTop: "1px solid rgb(var(--border-sidebar))",
        padding:
          "8px calc(4px + env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) calc(4px + env(safe-area-inset-left, 0px))",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}
    >
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        const href = withArtistStudio(tab.href, activeStudioId);
        return (
          <Link
            key={tab.href}
            href={href}
            prefetch={false}
            onNavigate={() => {
              announceRuntimeMainNavigationIntent(href);
            }}
            {...(active ? { "aria-current": "page" as const } : {})}
            className="sk-press relative flex flex-col items-center gap-1 rounded-md py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
            style={{
              flex: 1,
              minHeight: 68,
              color: active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.55)",
            }}
          >
            <Icon name={tab.icon} size={24} strokeWidth={active ? 2.4 : 2} />
            <span
              style={{
                fontSize: 11,
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
                  top: -8,
                  width: 30,
                  height: 3,
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
