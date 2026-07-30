"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  ArtistNotificationPanel,
  type ArtistNotificationFeedItem,
} from "~/components/artist/artist-notification-bell";
import { ProfessionalArtistHome } from "~/components/artist/home/professional-home";
import { MySessionsScreen } from "~/components/artist/sessions/my-sessions-screen";
import { SessionDetailScreen } from "~/components/artist/sessions/session-detail-screen";
import { ArtistSettingsClient } from "~/components/artist/settings/artist-settings-client";
import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { QuietProductList } from "~/components/artist/store/quiet-product-list";

import {
  DEV_ARTIST_ALLOWANCES,
  DEV_ARTIST_HOME_MAIN,
  DEV_ARTIST_HOME_SUPPORTING,
  DEV_ARTIST_NOTIFICATION_PREFERENCES,
  DEV_ARTIST_NOTIFICATIONS,
  DEV_ARTIST_NOW_ISO,
  DEV_ARTIST_SESSIONS,
  DEV_ARTIST_SESSION_DETAIL,
  DEV_ARTIST_STUDIO_ID,
  DEV_ARTIST_STUDIOS,
  DEV_ARTIST_STORE_PRODUCTS,
} from "./artist-platform-standing-fixtures";

function PreviewCanvas({
  children,
  width = "max-w-[1040px]",
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="min-h-dvh bg-[rgb(var(--bg-background))] px-4 py-6 sm:px-6 sm:py-9"
    >
      <div className={`mx-auto w-full ${width}`}>{children}</div>
    </main>
  );
}

export function ArtistHomeDevPreview() {
  return (
    <PreviewCanvas width="max-w-[900px]">
      <div inert className="pointer-events-none">
        <ProfessionalArtistHome
          greeting="Good morning, Maya."
          studioName="Northline Studio"
          main={DEV_ARTIST_HOME_MAIN}
          supporting={DEV_ARTIST_HOME_SUPPORTING}
          welcome={false}
        />
      </div>
    </PreviewCanvas>
  );
}

export function ArtistStoreCatalogDevPreview() {
  const [focal, ...rest] = DEV_ARTIST_STORE_PRODUCTS;
  if (!focal) return null;

  return (
    <PreviewCanvas>
      <div className="mx-auto w-full max-w-[920px] space-y-5">
        <header className="px-1 sm:px-0">
          <p className="font-mono text-[9px] font-semibold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
            Studio services
          </p>
          <h1 className="font-display mt-1 text-[26px] leading-none font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-[30px]">
            Store
          </h1>
        </header>
        <ProducerHero producerName="Northline Studio" producerLogoUrl={null} />
        <FocalProductCard
          product={focal}
          producerName="Northline Studio"
          studioId={DEV_ARTIST_STUDIO_ID}
          taxMode="tax_added"
          taxRatePct={18}
          onPreviewDetails={() => undefined}
        />
        <QuietProductList
          producerName="Northline Studio"
          studioId={DEV_ARTIST_STUDIO_ID}
          taxMode="tax_added"
          taxRatePct={18}
          products={rest}
          onPreviewDetails={() => undefined}
        />
      </div>
    </PreviewCanvas>
  );
}

export function ArtistSessionsHubDevPreview() {
  return (
    <PreviewCanvas width="max-w-[760px]">
      <div inert className="pointer-events-none">
        <MySessionsScreen
          sessions={DEV_ARTIST_SESSIONS}
          allowances={DEV_ARTIST_ALLOWANCES}
          nowISO={DEV_ARTIST_NOW_ISO}
        />
      </div>
    </PreviewCanvas>
  );
}

export function ArtistSessionDetailDevPreview() {
  return (
    <PreviewCanvas width="max-w-[520px]">
      <div inert className="pointer-events-none">
        <SessionDetailScreen session={DEV_ARTIST_SESSION_DETAIL} />
      </div>
    </PreviewCanvas>
  );
}

export function ArtistSettingsDevPreview() {
  return (
    <PreviewCanvas>
      <header className="mx-auto mb-6 w-full max-w-5xl">
        <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
          Your account
        </p>
        <h1 className="font-display mt-1 text-[32px] leading-none font-extrabold tracking-[-0.04em] text-[rgb(var(--fg-default))] sm:text-[38px]">
          Settings<span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Manage your profile, timezone, notifications, and studio connections.
        </p>
      </header>
      <div inert className="pointer-events-none">
        <ArtistSettingsClient
          identity={{
            fullName: "Maya Cohen",
            email: "maya@example.com",
            imageUrl: null,
            joinedLabel: "May 2026",
          }}
          initialTimezone="America/New_York"
          initialPreferences={DEV_ARTIST_NOTIFICATION_PREFERENCES}
          connectedStudios={DEV_ARTIST_STUDIOS}
          pastStudios={[
            {
              producerId: "00000000-0000-4000-8000-000000000213",
              name: "Harbor Sound",
              slug: "harbor-sound",
              logoUrl: null,
              disconnectedAtIso: "2026-06-12T10:00:00.000Z",
            },
          ]}
        />
      </div>
    </PreviewCanvas>
  );
}

export function ArtistNotificationCenterDevPreview() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<ArtistNotificationFeedItem[]>([...DEV_ARTIST_NOTIFICATIONS]);
  const visibleItems = useMemo(
    () => (tab === "all" ? items : items.filter((item) => item.readAtIso === null)),
    [items, tab],
  );
  const unreadCount = items.filter((item) => item.readAtIso === null).length;

  const markOne = (item: ArtistNotificationFeedItem) => {
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, readAtIso: DEV_ARTIST_NOW_ISO } : candidate,
      ),
    );
    return Promise.resolve();
  };
  const openOne = (item: ArtistNotificationFeedItem) => {
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              readAtIso: candidate.readAtIso ?? DEV_ARTIST_NOW_ISO,
              openedAtIso: candidate.openedAtIso ?? DEV_ARTIST_NOW_ISO,
            }
          : candidate,
      ),
    );
    return Promise.resolve();
  };
  const markAll = () => {
    setItems((current) =>
      current.map((item) => ({
        ...item,
        readAtIso: item.readAtIso ?? DEV_ARTIST_NOW_ISO,
      })),
    );
  };

  return (
    <PreviewCanvas width="max-w-[900px]">
      <div inert className="pointer-events-none opacity-40">
        <ProfessionalArtistHome
          greeting="Good morning, Maya."
          studioName="Northline Studio"
          main={DEV_ARTIST_HOME_MAIN}
          supporting={DEV_ARTIST_HOME_SUPPORTING}
          welcome={false}
        />
      </div>
      <div aria-hidden className="fixed inset-0 z-40 bg-black/30 lg:hidden" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-hidden rounded-t-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)] lg:inset-x-auto lg:top-[60px] lg:right-4 lg:bottom-auto lg:w-[390px] lg:rounded-[var(--radius-lg)]"
      >
        <ArtistNotificationPanel
          tab={tab}
          setTab={setTab}
          items={visibleItems}
          loading={false}
          markingAll={false}
          pendingId={null}
          unreadCount={unreadCount}
          error={null}
          onRetry={() => undefined}
          onMarkAll={markAll}
          onMarkOne={markOne}
          onOpen={openOne}
          relativeNow={new Date(DEV_ARTIST_NOW_ISO)}
        />
      </section>
    </PreviewCanvas>
  );
}
