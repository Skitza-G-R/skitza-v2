import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isArtistNavItemActive } from "../artist-nav-active";

const here = dirname(fileURLToPath(import.meta.url));
const BOTTOM = readFileSync(join(here, "..", "artist-bottom-nav.tsx"), "utf8");
const SIDEBAR = readFileSync(join(here, "..", "artist-desktop-sidebar.tsx"), "utf8");
const MOBILE_TOPBAR = readFileSync(join(here, "..", "artist-mobile-top-bar.tsx"), "utf8");
const SWITCHER = readFileSync(join(here, "..", "..", "artist", "studio-switcher.tsx"), "utf8");

describe("artist Payments navigation", () => {
  it("replaces Settings with Payments in the mobile main navigation", () => {
    expect(BOTTOM).toMatch(
      /href:\s*["']\/artist\/payments["'],\s*label:\s*["']Payments["'],\s*icon:\s*["']payments["']/,
    );
    expect(BOTTOM).not.toMatch(/href:\s*["']\/artist\/settings["'],\s*label:\s*["']Settings["']/);
  });

  it("replaces Settings with Payments in the desktop main navigation", () => {
    expect(SIDEBAR).toMatch(
      /id:\s*["']payments["'],\s*href:\s*["']\/artist\/payments["'],\s*label:\s*["']Payments["']/,
    );
    expect(SIDEBAR).not.toMatch(/id:\s*["']settings["'],\s*href:\s*["']\/artist\/settings["']/);
  });

  it("keeps Settings in both artist account controls", () => {
    for (const source of [SIDEBAR, MOBILE_TOPBAR]) {
      expect(source).toContain("<UserButton.MenuItems>");
      expect(source).toContain("<UserButton.Link");
      expect(source).toContain('label="Settings"');
      expect(source).toMatch(
        /href=\{withArtistStudio\(["']\/artist\/settings["'],\s*activeStudioId\)\}/,
      );
    }
  });
});

describe("artist studio-aware navigation", () => {
  it("threads the selected studio through mobile and desktop tab links", () => {
    for (const source of [BOTTOM, SIDEBAR]) {
      expect(source).toContain("useSearchParams");
      expect(source).toContain("withArtistStudio");
      expect(source).toContain("resolveArtistStudioId");
    }
  });

  it("leaves primary-route prefetching to the serial runtime warmer", () => {
    expect(BOTTOM.match(/prefetch=\{false\}/g)).toHaveLength(1);
    expect(SIDEBAR.match(/prefetch=\{false\}/g)).toHaveLength(2);
    expect(BOTTOM).toContain("announceRuntimeMainNavigationIntent(href)");
    expect(SIDEBAR.match(/announceRuntimeMainNavigationIntent/g)?.length).toBeGreaterThanOrEqual(3);
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
});

describe("artist Book section navigation", () => {
  it("treats My Sessions and session details as part of Book", () => {
    for (const pathname of [
      "/artist/book",
      "/artist/book/producer-1",
      "/artist/sessions",
      "/artist/sessions/session-1",
    ]) {
      expect(isArtistNavItemActive(pathname, "/artist/book")).toBe(true);
    }
  });

  it("does not activate Book for unrelated artist sections", () => {
    for (const pathname of [
      "/artist",
      "/artist/music",
      "/artist/store",
      "/artist/payments",
      "/artist/settings",
    ]) {
      expect(isArtistNavItemActive(pathname, "/artist/book")).toBe(false);
    }
  });

  it("uses the shared section matcher in both artist navigation surfaces", () => {
    for (const source of [BOTTOM, SIDEBAR]) {
      expect(source).toContain("isArtistNavItemActive(pathname");
    }
  });
});
