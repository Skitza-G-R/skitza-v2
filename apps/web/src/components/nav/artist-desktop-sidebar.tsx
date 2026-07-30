"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { StudioSwitcher } from "~/components/artist/studio-switcher";
import { LogoMark } from "~/components/brand/logo-mark";
import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
} from "~/lib/runtime-state/navigation-cache";
import type { Studio } from "~/server/artist/identity";

import { isArtistNavItemActive } from "./artist-nav-active";
import { ArtistUserButton } from "./artist-user-button";
import { Icon, type IconName } from "./icons";
import { Wordmark } from "./wordmark";

// ─── Artist desktop left sidebar (lg+) ──────────────────────────────
//
// Net-new chrome surface — Phase 2 introduces a desktop layout for
// the artist app (the prior implementation had a single header + main
// + bottom nav across all viewports). The locked design (notes/
// shell.artist-desktop.jsx) specifies 248px dark sidebar with five
// nav items. The artist product uses four standing destinations.
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
  { id: "sessions", href: "/artist/sessions", label: "Sessions", icon: "calendar" },
  { id: "store", href: "/artist/store", label: "Store", icon: "tag" },
] as const;

export function ArtistDesktopSidebar({
  studios,
  userId,
  initialStudioId,
  notificationStudioDotIds,
  isProducer,
}: {
  studios: Studio[];
  userId: string;
  initialStudioId: string | null;
  notificationStudioDotIds: readonly string[];
  isProducer: boolean;
}): ReactNode {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStudioId = resolveArtistStudioId(
    studios,
    searchParams.get("studio"),
    initialStudioId,
  );
  const isActive = (href: string) => isArtistNavItemActive(pathname, href);

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
        href={withArtistStudio("/artist", activeStudioId)}
        data-sk-nav-destination={withArtistStudio("/artist", activeStudioId)}
        prefetch={false}
        onClick={(event) => {
          captureRuntimeMainNavigationTarget(event.currentTarget);
        }}
        onNavigate={() => {
          announceRuntimeMainNavigationIntent(withArtistStudio("/artist", activeStudioId));
        }}
        aria-label="Skitza artist home"
        className="sk-press flex items-center"
        style={{ gap: 10, padding: "4px 8px 18px" }}
      >
        <LogoMark size={30} />
        <Wordmark size={18} inverse lowercase />
      </Link>

      {/* Studio switcher — multi-producer artists need this on every
          surface, including desktop. Existing component; visually
          mismatched on the dark surface for Phase 2, designed for
          warm canvas. Documented in handoff. */}
      <div style={{ padding: "0 4px 14px" }}>
        <StudioSwitcher
          studios={studios}
          userId={userId}
          initialStudioId={initialStudioId}
          notificationStudioDotIds={notificationStudioDotIds}
          inverse
        />
      </div>

      {/* Nav rail */}
      <nav aria-label="Primary" className="flex flex-col" style={{ gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const href = withArtistStudio(item.href, activeStudioId);
          return (
            <Link
              key={item.id}
              href={href}
              data-sk-nav-destination={href}
              prefetch={false}
              onClick={(event) => {
                captureRuntimeMainNavigationTarget(event.currentTarget);
              }}
              onNavigate={() => {
                announceRuntimeMainNavigationIntent(href);
              }}
              {...(active ? { "aria-current": "page" as const } : {})}
              className="sk-press relative flex items-center rounded-[10px] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                gap: 12,
                padding: "10px 12px",
                background: active ? "rgb(var(--fg-onsidebar) / 0.10)" : "transparent",
                color: active ? "rgb(var(--fg-onsidebar))" : "rgb(var(--fg-onsidebar) / 0.65)",
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                letterSpacing: "-0.005em",
                minHeight: 44,
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    insetInlineStart: -5,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    background: "rgb(var(--brand-primary))",
                    borderRadius: 2,
                  }}
                />
              )}
              <span className="flex h-5 w-5 items-center justify-center">
                <Icon name={item.icon} size={16} strokeWidth={2.3} />
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
        <ArtistUserButton
          userId={userId}
          isProducer={isProducer}
          settingsHref={withArtistStudio("/artist/settings", activeStudioId)}
          ringClassName="ring-[rgb(var(--border-sidebar))]"
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
