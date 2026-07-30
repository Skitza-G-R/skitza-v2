import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { StudioSwitcher } from "~/components/artist/studio-switcher";
import { LogoMark } from "~/components/brand/logo-mark";
import { Icon, type IconName } from "~/components/nav/icons";
import { Wordmark } from "~/components/nav/wordmark";

import {
  DEV_ARTIST_NOTIFICATIONS,
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

const PREVIEW_UNREAD_COUNT = DEV_ARTIST_NOTIFICATIONS.filter(
  (notification) => notification.readAtIso === null,
).length;

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
        />
      </div>
    </Suspense>
  );
}

function PreviewNotificationLink({
  activeDestination,
  dark = false,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
  dark?: boolean;
}) {
  const active = activeDestination === "notifications";
  const badge = PREVIEW_UNREAD_COUNT > 99 ? "99+" : String(PREVIEW_UNREAD_COUNT);

  return (
    <Link
      href="/dev/screens/artist-notifications"
      prefetch={false}
      aria-label={`Notifications, ${badge} unread`}
      {...(active ? { "aria-current": "page" as const } : {})}
      className={`sk-press relative inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none ${
        active
          ? "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]"
          : dark
            ? "text-[rgb(var(--fg-onsidebar)/0.62)] hover:bg-[rgb(var(--fg-onsidebar)/0.08)]"
            : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
      } focus-visible:ring-[rgb(var(--focus-ring))]`}
    >
      <Icon name="bell" size={19} strokeWidth={1.8} />
      <span className="absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary))] px-1 font-mono text-[9px] font-bold text-[rgb(var(--fg-on-brand))] ring-2 ring-[rgb(var(--bg-elevated))]">
        {badge}
      </span>
    </Link>
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

function PreviewMobileTopBar({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  return (
    <header
      aria-label="Artist preview top bar"
      className="sk-safe-top sk-safe-x sticky top-0 z-30 flex items-center justify-between gap-3 backdrop-blur lg:hidden"
      style={{
        background: "rgb(var(--bg-background) / 0.92)",
        borderBottom: "1px solid rgb(var(--border-subtle))",
        padding: "12px 16px",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
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
      <div className="flex shrink-0 items-center gap-1">
        <PreviewNotificationLink activeDestination={activeDestination} />
        <PreviewArtistAvatar activeDestination={activeDestination} />
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
              className="sk-press relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                background: active ? "rgb(var(--fg-onsidebar) / 0.08)" : "transparent",
                color: active ? "rgb(var(--fg-onsidebar))" : "rgb(var(--fg-onsidebar) / 0.62)",
                fontFamily: "var(--font-outfit)",
                fontSize: 14.5,
                fontWeight: active ? 600 : 500,
              }}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 -left-4 w-0.5 rounded-full bg-[rgb(var(--brand-primary))]"
                />
              ) : null}
              <span className="flex h-5 w-5 items-center justify-center">
                <Icon
                  name={item.icon === "store" ? "tag" : item.icon}
                  size={20}
                  strokeWidth={1.7}
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

function PreviewDesktopTopBar({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  return (
    <header
      aria-label="Page navigation"
      className="sticky top-0 z-30 hidden border-b border-[rgb(var(--border-subtle)/0.6)] backdrop-blur-[60px] lg:block"
      style={{
        background: "rgb(var(--bg-background) / 0.88)",
        WebkitBackdropFilter: "blur(60px)",
      }}
    >
      <div className="flex min-h-[52px] w-full items-center gap-3 px-4">
        <span className="font-display text-sm font-semibold text-[rgb(var(--fg-default))]">
          {DESTINATION_LABELS[activeDestination]}
        </span>
        <div className="ml-auto">
          <PreviewNotificationLink activeDestination={activeDestination} />
        </div>
      </div>
    </header>
  );
}

function PreviewBottomNav({
  activeDestination,
}: {
  activeDestination: ArtistPlatformPreviewDestination;
}) {
  return (
    <nav
      aria-label="Artist preview tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden"
      style={{
        background: "rgb(var(--bg-sidebar))",
        borderTop: "1px solid rgb(var(--border-sidebar))",
        padding:
          "8px calc(4px + env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) calc(4px + env(safe-area-inset-left, 0px))",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
      }}
    >
      {PREVIEW_NAV_ITEMS.map((item) => {
        const active = activeDestination === item.destination;
        return (
          <Link
            key={item.destination}
            href={item.href}
            prefetch={false}
            {...(active ? { "aria-current": "page" as const } : {})}
            className="sk-press relative flex min-h-[68px] flex-1 flex-col items-center gap-1 rounded-md py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
            style={{
              color: active ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.55)",
            }}
          >
            <Icon name={item.icon} size={24} strokeWidth={active ? 2.4 : 2} />
            <span
              className="text-[11px]"
              style={{
                fontWeight: active ? 700 : 500,
                letterSpacing: "-0.005em",
              }}
            >
              {item.label}
            </span>
            {active ? (
              <span
                aria-hidden
                className="absolute -top-2 h-[3px] w-[30px] rounded-[2px] bg-[rgb(var(--brand-primary))]"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
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
    >
      <PreviewDesktopSidebar activeDestination={activeDestination} />
      <div className="flex min-w-0 flex-1 flex-col">
        <PreviewMobileTopBar activeDestination={activeDestination} />
        <PreviewDesktopTopBar activeDestination={activeDestination} />
        <div className="min-w-0 flex-1 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
          {children}
        </div>
      </div>
      <PreviewBottomNav activeDestination={activeDestination} />
    </div>
  );
}
