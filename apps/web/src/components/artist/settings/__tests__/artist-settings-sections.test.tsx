// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedArtistNotificationPreferences } from "~/server/artist/profile";

import { ArtistSettingsClient } from "../artist-settings-client";
import {
  ARTIST_SETTINGS_SECTION_KEYS,
  ARTIST_SETTINGS_SECTIONS,
  isArtistSettingsSectionKey,
} from "../artist-settings-sections";

const actionMocks = vi.hoisted(() => ({
  commitDisconnect: vi.fn(),
  previewDisconnect: vi.fn(),
  savePreferences: vi.fn(),
  saveTimezone: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="clerk-user-button" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/app/(artist)/artist/settings/actions", () => ({
  commitArtistDisconnectAction: actionMocks.commitDisconnect,
  previewArtistDisconnectAction: actionMocks.previewDisconnect,
  saveArtistNotificationPreferencesAction: actionMocks.savePreferences,
  saveArtistTimezoneAction: actionMocks.saveTimezone,
}));

const DEFAULT_CHANNELS = {
  inApp: true,
  transactionalEmail: true,
  activityEmail: false,
} as const;

const PREFERENCES = {
  purchase: DEFAULT_CHANNELS,
  proof: DEFAULT_CHANNELS,
  booking: DEFAULT_CHANNELS,
  session_reminder: DEFAULT_CHANNELS,
  new_music: {
    inApp: true,
    transactionalEmail: false,
    activityEmail: false,
  },
  producer_comment: {
    inApp: true,
    transactionalEmail: false,
    activityEmail: false,
  },
} satisfies ResolvedArtistNotificationPreferences;

function renderSettings(initialActive: (typeof ARTIST_SETTINGS_SECTION_KEYS)[number] = "profile") {
  return render(
    <ArtistSettingsClient
      initialActive={initialActive}
      previewOnly
      identity={{
        fullName: "Maya Cohen",
        email: "maya@example.com",
        imageUrl: null,
        joinedLabel: "May 2026",
      }}
      initialTimezone="America/New_York"
      initialPreferences={PREFERENCES}
      connectedStudios={[
        {
          producerId: "studio-1",
          name: "Northline Studio",
          slug: "northline",
          logoUrl: null,
        },
      ]}
      pastStudios={[]}
    />,
  );
}

describe("artist Settings section contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/artist/settings?studio=studio-1");
  });

  afterEach(cleanup);

  it("uses the four approved top-menu keys in order", () => {
    expect(ARTIST_SETTINGS_SECTION_KEYS).toEqual([
      "profile",
      "notifications",
      "timezone",
      "studios",
    ]);
    expect(ARTIST_SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      "Profile",
      "Notifications",
      "Timezone",
      "Studios",
    ]);
    expect(isArtistSettingsSectionKey("studios")).toBe(true);
    expect(isArtistSettingsSectionKey("appearance")).toBe(false);
  });

  it("switches one visible group at a time and preserves edits across tabs", () => {
    renderSettings();

    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    const notificationsTab = screen.getByRole("button", { name: "Notifications" });
    expect(notificationsTab.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Profile" })).toBeNull();

    const purchaseInApp = screen.getByRole("switch", {
      name: "Purchases in-app notifications",
    });
    expect(purchaseInApp.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(purchaseInApp);
    expect(purchaseInApp.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Timezone" }));
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(
      screen
        .getByRole("switch", { name: "Purchases in-app notifications" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("updates only the section query and keeps preview actions local", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(window.location.pathname).toBe("/artist/settings");
    expect(new URLSearchParams(window.location.search).get("studio")).toBe("studio-1");
    expect(new URLSearchParams(window.location.search).get("section")).toBe("notifications");

    fireEvent.click(screen.getByRole("switch", { name: "Purchases in-app notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Save notifications" }));
    expect(actionMocks.savePreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Timezone" }));
    fireEvent.change(screen.getByLabelText("Your timezone"), {
      target: { value: "Europe/London" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(actionMocks.saveTimezone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Studios" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect studio" }));
    expect(actionMocks.previewDisconnect).not.toHaveBeenCalled();
    expect(actionMocks.commitDisconnect).not.toHaveBeenCalled();
  });

  it("keeps the producer-pattern swipe and server deep-link wiring", () => {
    const clientSource = readFileSync(
      join(process.cwd(), "src/components/artist/settings/artist-settings-client.tsx"),
      "utf8",
    );
    const pageSource = readFileSync(
      join(process.cwd(), "src/app/(artist)/artist/settings/page.tsx"),
      "utf8",
    );

    expect(clientSource).toContain("useTabSwipe");
    expect(clientSource).toContain("items: ARTIST_SETTINGS_SECTION_KEYS");
    expect(clientSource).toContain("onChange: changeSection");
    expect(clientSource).toContain("window.history.replaceState");
    expect(clientSource).toContain("data-tab-swipe-surface");
    expect(clientSource).toContain("data-tab-swipe-panel");
    expect(clientSource).toContain("overflow-x-auto");
    expect(clientSource).not.toContain("lg:grid-cols");
    expect(pageSource).toContain("searchParams");
    expect(pageSource).toContain("isArtistSettingsSectionKey(params.section)");
    expect(pageSource).toContain("initialActive={initialActive}");
  });
});
