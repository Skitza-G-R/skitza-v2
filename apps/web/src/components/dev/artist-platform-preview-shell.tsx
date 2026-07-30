"use client";

import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { ArtistNotificationBell } from "~/components/artist/artist-notification-bell";
import { StudioSwitcher } from "~/components/artist/studio-switcher";
import { LogoMark } from "~/components/brand/logo-mark";
import { Icon, type IconName } from "~/components/nav/icons";
import {
  LiquidGlassBottomNav,
  type LiquidGlassBottomNavTab,
} from "~/components/nav/liquid-glass-bottom-nav";
import { Wordmark } from "~/components/nav/wordmark";

import {
  DEV_ARTIST_NOTIFICATIONS,
  DEV_ARTIST_NOW_ISO,
  DEV_ARTIST_SECOND_STUDIO_ID,
  DEV_ARTIST_STUDIO_ID,
  DEV_ARTIST_STUDIOS,
} from "./artist-platform-standing-fixtures";

export type ArtistPlatformPreviewDestination =
  | "home"
  | "music"
  | "sessions"
  | "store"
  | "settings"
  | "notifications";

type PreviewNavItem = Readonly<{
  destination: Exclude<ArtistPlatformPreviewDestination, "settings" | "notifications">;
  href: string;
  label: string;
  icon: IconName;
}>;

const PREVIEW_NAV_ITEMS: readonly PreviewNavItem[] = [
  {
    destination: "home",
    href: "/dev/screens/artist-home",
    label: "Home",
    icon: "home",
  },
  {
    destination: "music",
    href: "/dev/screens/artist-library-lifecycle",
    label: "Music",
    icon: "music",
  },
  {
    destination: "sessions",
    href: "/dev/screens/artist-sessions",
    label: "Sessions",
    icon: "calendar",
  },
  {
    destination: "store",
    href: "/dev/screens/artist-store",
    label: "Store",
    icon: "store",
  },
] as const;

const DESTINATION_LABELS: Readonly<Record<ArtistPlatformPreviewDestination, string>> = {
  home: "Home",
  music: "Music",
  sessions: "Sessions",
  store: "Store",
  settings: "Settings",
  notifications: "Notifications",
};

function PreviewStudioIdentity({ inverse = false }: { inverse?: boolean }) {
  return (
    <Suspense
      fallback={
        <div
          aria-label="Selected studio"
          className={`flex min-h-11 items-center rounded-[var(--radius-lg)] px-2 text-sm ${
            inverse ? "text-[rgb(var(--fg-onsidebar)/0.68)]" : "text-[rgb(var(--fg-muted))]"
          }`}
        >
          Northline Studio
        </div>
      }
    >
      <div className={inverse ? "text-[rgb(var(--fg-onsidebar))]" : ""}>
        <StudioSwitcher
          studios={DEV_ARTIST_STUDIOS}
          userId="dev_artist_preview"
          initialStudioId={DEV_ARTIST_STUDIO_ID}
          notificationStudioDotIds={[DEV_ARTIST_STUDIO_ID, DEV_ARTIST_SECOND_STUDIO_ID]}
          previewOnly
          inverse={inverse}
        />
      </div>
    </Suspense>
  );
}

function PreviewArtistAvatar({
  activeDestination,
  dark = false,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
  dark?: boolean;
}) {
  const active = activeDestination === "settings";

  return (
    <Link
      href="/dev/screens/artist-settings"
      prefetch={false}
      aria-label="Maya Cohen, open settings"
      {...(active ? { "aria-current": "page" as const } : {})}
      className={`sk-press font-display inline-flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[12px] font-extrabold text-[rgb(var(--fg-on-brand))] ring-2 focus-visible:ring-[3px] focus-visible:outline-none ${
        active
          ? "ring-[rgb(var(--brand-primary)/0.46)]"
          : dark
            ? "ring-[rgb(var(--border-sidebar))]"
            : "ring-[rgb(var(--border-subtle))]"
      } focus-visible:ring-[rgb(var(--focus-ring))]`}
    >
      MC
    </Link>
  );
}

function PreviewTopBar({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  return (
    <header
      aria-label="Artist preview top bar"
      className="sk-safe-top sticky top-0 z-30 border-b border-[rgb(var(--border-subtle)/0.72)] backdrop-blur-2xl"
      style={{
        background: "rgb(var(--bg-background) / 0.76)",
        boxShadow: "0 10px 30px -24px rgb(var(--bg-sidebar) / 0.45)",
        WebkitBackdropFilter: "blur(28px) saturate(145%)",
      }}
    >
      <div
        className="flex min-h-[68px] items-center gap-3 py-2 lg:min-h-[52px] lg:px-4 lg:py-1"
        style={{
          paddingInlineStart: "max(16px, env(safe-area-inset-left, 0px))",
          paddingInlineEnd: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
          <Link
            href="/dev/screens/artist-home"
            prefetch={false}
            aria-label="Skitza artist home"
            className="sk-press shrink-0 rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          >
            <Wordmark size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <PreviewStudioIdentity />
          </div>
        </div>
        <span className="font-display hidden text-sm font-semibold text-[rgb(var(--fg-default))] lg:block">
          {DESTINATION_LABELS[activeDestination]}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ArtistNotificationBell
            preview={{
              items: DEV_ARTIST_NOTIFICATIONS,
              initialOpen: activeDestination === "notifications",
              relativeNow: new Date(DEV_ARTIST_NOW_ISO),
            }}
          />
          <span className="lg:hidden">
            <PreviewArtistAvatar activeDestination={activeDestination} />
          </span>
        </div>
      </div>
    </header>
  );
}

function PreviewDesktopSidebar({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  return (
    <aside
      aria-label="Artist preview sidebar"
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
      <Link
        href="/dev/screens/artist-home"
        prefetch={false}
        aria-label="Skitza artist home"
        className="sk-press flex items-center rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        style={{ gap: 10, padding: "4px 8px 18px" }}
      >
        <LogoMark size={30} />
        <Wordmark size={18} inverse lowercase />
      </Link>

      <div style={{ padding: "0 4px 14px" }}>
        <PreviewStudioIdentity inverse />
      </div>

      <nav aria-label="Artist preview primary navigation" className="flex flex-col gap-0.5">
        {PREVIEW_NAV_ITEMS.map((item) => {
          const active = activeDestination === item.destination;
          return (
            <Link
              key={item.destination}
              href={item.href}
              prefetch={false}
              {...(active ? { "aria-current": "page" as const } : {})}
              className="sk-press relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                background: active ? "rgb(var(--fg-onsidebar) / 0.10)" : "transparent",
                color: active ? "rgb(var(--fg-onsidebar))" : "rgb(var(--fg-onsidebar) / 0.65)",
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                letterSpacing: "-0.005em",
              }}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 -left-[5px] w-[3px] rounded-[2px] bg-[rgb(var(--brand-primary))]"
                />
              ) : null}
              <span className="flex h-5 w-5 items-center justify-center">
                <Icon
                  name={item.icon === "store" ? "tag" : item.icon}
                  size={16}
                  strokeWidth={2.3}
                />
              </span>
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div
        className={`flex min-h-[68px] items-center gap-3 border-t px-2 pt-3 pb-1 ${
          activeDestination === "settings"
            ? "bg-[rgb(var(--fg-onsidebar)/0.06)]"
            : "hover:bg-[rgb(var(--fg-onsidebar)/0.04)]"
        }`}
        style={{ borderTopColor: "rgb(var(--border-sidebar))" }}
      >
        <PreviewArtistAvatar activeDestination={activeDestination} dark />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[rgb(var(--fg-onsidebar))]">
            Maya Cohen
          </span>
          <span className="mt-0.5 block font-mono text-[9px] tracking-[0.08em] text-[rgb(var(--fg-onsidebar)/0.5)] uppercase">
            Artist account
          </span>
        </span>
      </div>
    </aside>
  );
}

function PreviewBottomNav({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  const visibleDestination = activeDestination === "notifications" ? "home" : activeDestination;
  const tabs: readonly LiquidGlassBottomNavTab<PreviewNavItem["destination"]>[] =
    PREVIEW_NAV_ITEMS.map((item) => ({
      id: item.destination,
      label: item.label,
      href: item.href,
      icon: item.icon,
      active: visibleDestination === item.destination,
      prefetch: false,
    }));

  return (
    <LiquidGlassBottomNav
      ariaLabel="Artist preview tabs"
      tabs={tabs}
      position="fixed"
      frameClassName="artist-preview-bottom-nav-frame"
    />
  );
}

export function ArtistPlatformPreviewShell({
  activeDestination,
  screenLabel,
  children,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
  screenLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      data-artist-platform-preview-chrome="standing"
      data-artist-platform-preview-destination={activeDestination}
      data-artist-platform-preview-screen={screenLabel}
      className="flex min-h-dvh bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))]"
      style={{
        backgroundColor: "rgb(var(--bg-background))",
        backgroundImage:
          "radial-gradient(circle at 88% -6%, rgb(var(--brand-primary) / 0.11), transparent 30rem), radial-gradient(circle at 5% 92%, rgb(var(--brand-copper) / 0.07), transparent 34rem)",
      }}
    >
      <PreviewDesktopSidebar activeDestination={activeDestination} />
      <div className="flex min-w-0 flex-1 flex-col">
        <PreviewTopBar activeDestination={activeDestination} />
        <div className="min-w-0 flex-1 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
          {children}
        </div>
      </div>
      <PreviewBottomNav activeDestination={activeDestination} />
    </div>
  );
}
