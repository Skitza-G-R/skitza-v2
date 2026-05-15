"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

import { StudioSwitcher } from "~/components/artist/studio-switcher";
import { LogoMark } from "~/components/brand/logo-mark";
import type { Studio } from "~/server/artist/identity";

import { Icon, type IconName } from "./icons";
import { Wordmark } from "./wordmark";

// ─── Artist desktop left sidebar (lg+) ──────────────────────────────
//
// Net-new chrome surface — Phase 2 introduces a desktop layout for
// the artist app (the prior implementation had a single header + main
// + bottom nav across all viewports). The locked design (notes/
// shell.artist-desktop.jsx) specifies 248px dark sidebar with five
// nav items.
//
// "Messages" appears in the design source but no /artist/messages
// route exists yet — dropped for Phase 2 per Gili's Q3 ruling on the
// producer side (don't ship nav items that 404). Adding it back is a
// future task that needs both a route and an inbox surface to land
// together.
//
// The "Pinned projects" panel from the design depends on real project
// data + a "pin" boolean in the schema — neither exists for artist
// projects in v1, so the panel is intentionally omitted. Documented
// in docs/qa/phase-2-handoff.md so Phase 4+ knows where to drop it
// in.
//
// Active-state derivation matches the bottom nav: exact match on
// /artist for Home, prefix match elsewhere. Same rule, different
// surface.

type ArtistDesktopNav = {
  id: string;
  href: string;
  label: string;
  icon: IconName;
};

const NAV_ITEMS: readonly ArtistDesktopNav[] = [
  { id: "home", href: "/artist", label: "Home", icon: "home" },
  { id: "music", href: "/artist/music", label: "Music", icon: "music" },
  { id: "book", href: "/artist/book", label: "Book", icon: "plus" },
  { id: "store", href: "/artist/store", label: "Store", icon: "tag" },
  { id: "settings", href: "/artist/settings", label: "Settings", icon: "settings" },
] as const;

export function ArtistDesktopSidebar({
  studios,
}: {
  studios: Studio[];
}): ReactNode {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/artist" ? pathname === "/artist" : pathname.startsWith(href);

  return (
    <aside
      className="sticky top-0 hidden h-dvh shrink-0 flex-col border-e lg:flex"
      style={{
        width: 248,
        background: "rgb(var(--bg-sidebar))",
        color: "rgb(var(--fg-onsidebar))",
        borderInlineEndColor: "rgb(var(--border-sidebar))",
        padding: "20px 16px 18px",
        zIndex: 20,
      }}
    >
      {/* Logo lockup — mark + lowercase wordmark, matches producer rail. */}
      <Link
        href="/artist"
        aria-label="Skitza artist home"
        className="sk-press flex items-center gap-2"
        style={{ padding: "4px 8px 18px" }}
      >
        <LogoMark size={28} />
        <Wordmark size={20} inverse lowercase />
      </Link>

      {/* Studio switcher — multi-producer artists need this on every
          surface, including desktop. Existing component; visually
          mismatched on the dark surface for Phase 2, designed for
          warm canvas. Documented in handoff. */}
      <div style={{ padding: "0 4px 14px" }}>
        <StudioSwitcher studios={studios} />
      </div>

      {/* Nav rail */}
      <nav
        aria-label="Primary"
        className="flex flex-col"
        style={{ gap: 2 }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              {...(active ? { "aria-current": "page" as const } : {})}
              className="sk-press relative flex items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
              style={{
                gap: 12,
                padding: "10px 12px",
                background: active
                  ? "rgb(var(--fg-onsidebar) / 0.08)"
                  : "transparent",
                color: active
                  ? "rgb(var(--fg-onsidebar))"
                  : "rgb(var(--fg-onsidebar) / 0.62)",
                fontFamily: "var(--font-outfit)",
                fontSize: 14.5,
                fontWeight: active ? 600 : 500,
                minHeight: 40,
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    insetInlineStart: -16,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: "rgb(var(--brand-primary))",
                    borderRadius: 999,
                  }}
                />
              )}
              <span className="flex h-5 w-5 items-center justify-center">
                <Icon name={item.icon} size={20} strokeWidth={1.7} />
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Account chip — Clerk UserButton avatar with dark ring. */}
      <div
        className="flex items-center gap-3"
        style={{
          padding: "12px 8px 4px",
          borderTop: "1px solid rgb(var(--border-sidebar))",
        }}
      >
        <UserButton
          appearance={{
            elements: {
              avatarBox:
                "h-8 w-8 ring-1 ring-[rgb(var(--border-sidebar))]",
            },
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: "rgb(var(--fg-onsidebar) / 0.55)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Artist
        </span>
      </div>
    </aside>
  );
}
