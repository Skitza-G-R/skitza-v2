"use client";

import { type ReactNode } from "react";

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
  DEV_ARTIST_HOME_NEW_SONG,
  DEV_ARTIST_HOME_SUPPORTING,
  DEV_ARTIST_NOTIFICATION_PREFERENCES,
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
      className="min-h-dvh bg-transparent px-4 py-6 sm:px-6 sm:py-9"
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
          newSong={DEV_ARTIST_HOME_NEW_SONG}
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
      <MySessionsScreen
        sessions={DEV_ARTIST_SESSIONS}
        allowances={DEV_ARTIST_ALLOWANCES}
        nowISO={DEV_ARTIST_NOW_ISO}
        initialTab="upcoming"
        previewOnly
      />
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
      <ArtistSettingsClient
        initialActive="profile"
        previewOnly
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
    </PreviewCanvas>
  );
}

export function ArtistNotificationCenterDevPreview() {
  return (
    <PreviewCanvas width="max-w-[900px]">
      <div inert className="pointer-events-none">
        <ProfessionalArtistHome
          greeting="Good morning, Maya."
          studioName="Northline Studio"
          main={DEV_ARTIST_HOME_MAIN}
          newSong={DEV_ARTIST_HOME_NEW_SONG}
          supporting={DEV_ARTIST_HOME_SUPPORTING}
          welcome={false}
        />
      </div>
    </PreviewCanvas>
  );
}
