import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isArtistNavItemActive } from "../artist-nav-active";

const here = dirname(fileURLToPath(import.meta.url));
const BOTTOM = readFileSync(join(here, "..", "artist-bottom-nav.tsx"), "utf8");
const SHARED_BOTTOM = readFileSync(join(here, "..", "liquid-glass-bottom-nav.tsx"), "utf8");
const SIDEBAR = readFileSync(join(here, "..", "artist-desktop-sidebar.tsx"), "utf8");
const MOBILE_TOPBAR = readFileSync(join(here, "..", "artist-mobile-top-bar.tsx"), "utf8");
const USER_BUTTON = readFileSync(join(here, "..", "artist-user-button.tsx"), "utf8");
const ACCOUNT_ROLE_MENU = readFileSync(
  join(here, "..", "account-role-menu-items.tsx"),
  "utf8",
);
const SWITCHER = readFileSync(join(here, "..", "..", "artist", "studio-switcher.tsx"), "utf8");

describe("artist five-tab navigation", () => {
  it("uses Home, Music, Sessions, Payments, and Store in the mobile main navigation", () => {
    expect(BOTTOM.match(/\{\s*href:\s*"\/artist[^"]*"/g)).toHaveLength(5);
    for (const [href, label] of [
      ["/artist", "Home"],
      ["/artist/music", "Music"],
      ["/artist/sessions", "Sessions"],
      ["/artist/payments", "Payments"],
      ["/artist/store", "Store"],
    ] as const) {
      expect(BOTTOM).toContain(`{ href: "${href}", label: "${label}"`);
    }
    expect(BOTTOM).not.toMatch(/label:\s*["']Book["']/);
  });

  it("uses the same five destinations in the desktop main navigation", () => {
    expect(SIDEBAR.match(/\{\s*id:\s*"[^"]+"/g)).toHaveLength(5);
    for (const [href, label] of [
      ["/artist", "Home"],
      ["/artist/music", "Music"],
      ["/artist/sessions", "Sessions"],
      ["/artist/payments", "Payments"],
      ["/artist/store", "Store"],
    ] as const) {
      expect(SIDEBAR).toMatch(new RegExp(`href:\\s*"${href}",\\s*label:\\s*"${label}"`));
    }
    expect(SIDEBAR).not.toMatch(/label:\s*["']Book["']/);
  });

  it("keeps Settings in both artist account controls", () => {
    expect(SIDEBAR).toContain("<ArtistUserButton");
    expect(MOBILE_TOPBAR).toContain("<ArtistMobileUserButton");
    for (const source of [SIDEBAR, MOBILE_TOPBAR]) {
      expect(source).toContain(
        'settingsHref={withArtistStudio("/artist/settings", activeStudioId)}',
      );
    }
    expect(USER_BUTTON).toContain("renderAccountRoleMenuItems(menuModel)");
    expect(USER_BUTTON).toMatch(
      /renderAccountRoleMenuItems\(menuModel, \{\s*includeSettings: false,\s*\}\)/,
    );
    expect(USER_BUTTON).not.toContain("paymentsHref");
    expect(USER_BUTTON).toContain('className="sk-account-sheet-motion');
    expect(ACCOUNT_ROLE_MENU).toContain("<UserButton.MenuItems>");
    expect(ACCOUNT_ROLE_MENU).toContain('label="Settings"');
    expect(ACCOUNT_ROLE_MENU).not.toContain('label="Payments"');
  });

  it("mounts notification bells on mobile and desktop artist chrome", () => {
    expect(MOBILE_TOPBAR).toContain("<ArtistNotificationBell");
    expect(MOBILE_TOPBAR).toContain("notificationUnreadCount");
  });
});

describe("artist studio-aware navigation", () => {
  it("threads the selected studio through mobile and desktop tab links", () => {
    for (const source of [BOTTOM, SIDEBAR]) {
      expect(source).toContain("useSearchParams");
      expect(source).toContain("withArtistStudio");
      expect(source).toContain("resolveArtistStudioId");
      expect(source).toContain("initialStudioId");
    }
  });

  it("leaves primary-route prefetching to the serial runtime warmer", () => {
    expect(BOTTOM).toContain("prefetch: false");
    expect(SHARED_BOTTOM).toContain("prefetch={tab.prefetch ?? false}");
    expect(SIDEBAR.match(/prefetch=\{false\}/g)).toHaveLength(2);
    expect(BOTTOM).toContain("announceRuntimeMainNavigationIntent(tab.href)");
    expect(SIDEBAR.match(/announceRuntimeMainNavigationIntent/g)?.length).toBeGreaterThanOrEqual(3);
    expect(SHARED_BOTTOM).toContain("data-sk-nav-destination={tab.href}");
    expect(SIDEBAR.match(/data-sk-nav-destination=/g)).toHaveLength(2);
    expect(BOTTOM).toContain("captureRuntimeMainNavigationTarget(event.currentTarget)");
    expect(SIDEBAR.match(/captureRuntimeMainNavigationTarget/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the switcher trigger usable with a long studio name", () => {
    expect(SWITCHER).toContain("min-h-11");
    expect(SWITCHER).toContain("max-w-full");
    expect(SWITCHER).toMatch(/active\.name[\s\S]{0,100}truncate|truncate[\s\S]{0,100}active\.name/);
    expect(MOBILE_TOPBAR).toContain("flex min-w-0 flex-1");
  });

  it("uses the shared accessible dialog and ordinary buttons for studio selection", () => {
    expect(SWITCHER).toContain('from "~/components/ui/dialog"');
    expect(SWITCHER).toContain("<DialogTrigger asChild>");
    expect(SWITCHER).toContain("<DialogContent");
    expect(SWITCHER).not.toContain('role="listbox"');
    expect(SWITCHER).not.toContain('role="option"');
  });

  it("renders zero and one studio as non-interactive identities", () => {
    expect(SWITCHER).toContain("No active studio");
    expect(SWITCHER).toMatch(/studios\.length === 1/);
    expect(SWITCHER.indexOf("studios.length === 1")).toBeLessThan(
      SWITCHER.indexOf("<Dialog open="),
    );
  });

  it("persists a multi-studio choice before navigation", () => {
    const write = SWITCHER.indexOf("writeArtistStudioPreferenceCookie(userId, producerId)");
    const push = SWITCHER.indexOf("router.push(urlFor(producerId))", write);
    expect(write).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(write);
  });
});

describe("artist navigation active states", () => {
  it("keeps Home exact and activates section descendants", () => {
    expect(isArtistNavItemActive("/artist", "/artist")).toBe(true);
    expect(isArtistNavItemActive("/artist/music", "/artist")).toBe(false);
    expect(isArtistNavItemActive("/artist/music/song-1", "/artist/music")).toBe(true);
    expect(isArtistNavItemActive("/artist/sessions/session-1", "/artist/sessions")).toBe(true);
    expect(isArtistNavItemActive("/artist/payments", "/artist/payments")).toBe(true);
    expect(isArtistNavItemActive("/artist/payments/history", "/artist/payments")).toBe(true);
    expect(isArtistNavItemActive("/artist/settings", "/artist/payments")).toBe(false);
  });

  it("treats standing store resource routes as Store", () => {
    for (const pathname of [
      "/artist/store",
      "/artist/store/product-1",
      "/artist/purchase/product-1",
      "/artist/offers/offer-1",
    ]) {
      expect(isArtistNavItemActive(pathname, "/artist/store")).toBe(true);
    }
  });

  it("does not activate Store for unrelated artist sections", () => {
    for (const pathname of [
      "/artist",
      "/artist/music",
      "/artist/sessions",
      "/artist/payments",
      "/artist/settings",
    ]) {
      expect(isArtistNavItemActive(pathname, "/artist/store")).toBe(false);
    }
  });

  it("uses the shared section matcher in both artist navigation surfaces", () => {
    for (const source of [BOTTOM, SIDEBAR]) {
      expect(source).toContain("isArtistNavItemActive(pathname");
    }
  });
});
