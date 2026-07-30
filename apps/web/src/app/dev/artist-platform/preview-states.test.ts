import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ARTIST_PLATFORM_PREVIEW_GROUPS, findArtistPlatformPreviewState } from "./preview-states";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "page.tsx"), "utf8");
const screensSource = readFileSync(join(here, "..", "screens", "[screen]", "page.tsx"), "utf8");
const standingSource = readFileSync(
  join(here, "..", "..", "..", "components", "dev", "artist-platform-standing-previews.tsx"),
  "utf8",
);
const shellSource = readFileSync(
  join(here, "..", "..", "..", "components", "dev", "artist-platform-preview-shell.tsx"),
  "utf8",
);

function screenName(href: string): string {
  return href.replace("/dev/screens/", "");
}

function screenCaseSource(screen: string): string {
  const marker = `case "${screen}":`;
  const start = screensSource.indexOf(marker);
  if (start < 0) return "";
  const next = screensSource.indexOf('\n    case "', start + marker.length);
  return screensSource.slice(start, next < 0 ? screensSource.length : next);
}

describe("artist platform preview handoff", () => {
  it("links each deterministic fixture exactly once", () => {
    const hrefs = ARTIST_PLATFORM_PREVIEW_GROUPS.flatMap((group) =>
      group.states.map((state) => state.href),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/dev/screens/artist-home",
        "/dev/screens/artist-store",
        "/dev/screens/artist-sessions",
        "/dev/screens/artist-session-detail",
        "/dev/screens/artist-settings",
        "/dev/screens/artist-notifications",
        "/dev/screens/s3",
        "/dev/screens/s3-pending",
        "/dev/screens/s8",
        "/dev/screens/s9",
        "/dev/screens/s9-awaiting",
        "/dev/screens/s9-rejected",
        "/dev/screens/s9-partial",
        "/dev/screens/s9-paid",
      ]),
    );
  });

  it("uses the preview deployment guard and no auth or database caller", () => {
    expect(indexSource).toContain("isDevGalleryAvailable()");
    expect(indexSource).not.toMatch(/\bauth\(|currentUser\(|appRouter|createDb/);
    expect(screensSource).toContain("isDevGalleryAvailable()");
    expect(standingSource).not.toMatch(/\bauth\(|currentUser\(|appRouter|createDb/);
    expect(standingSource).toContain("<div inert");
    expect(shellSource).toContain("previewOnly");
    expect(shellSource).not.toMatch(/@clerk|\bauth\(|currentUser\(|appRouter|createDb/);
  });

  it("maps every standing screen to its exact artist destination", () => {
    const standingDestinations = Object.fromEntries(
      ARTIST_PLATFORM_PREVIEW_GROUPS.flatMap((group) =>
        group.states
          .filter((state) => state.chrome === "Standing")
          .map((state) => [screenName(state.href), state.activeDestination]),
      ),
    );

    expect(standingDestinations).toEqual({
      "artist-home": "home",
      "artist-store": "store",
      "artist-sessions": "sessions",
      "artist-session-detail": "sessions",
      "artist-settings": "settings",
      "artist-notifications": "notifications",
      "artist-library-lifecycle": "music",
      "artist-project-completed": "music",
      "artist-project-canceled": "music",
      s3: "store",
      "s3-pending": "store",
      "s9-awaiting": "store",
      "s9-rejected": "store",
      "s9-partial": "store",
      "s9-paid": "store",
    });
  });

  it("wraps every standing route once and leaves every focused route process-only", () => {
    const states = ARTIST_PLATFORM_PREVIEW_GROUPS.flatMap((group) => group.states);
    for (const state of states) {
      const screen = screenName(state.href);
      const source = screenCaseSource(screen);
      expect(source, `${screen} route is missing`).not.toBe("");
      if (state.chrome === "Standing") {
        expect(source).toContain("withArtistPlatformStandingChrome(");
        expect(findArtistPlatformPreviewState(screen)?.activeDestination).toBe(
          state.activeDestination,
        );
      } else {
        expect(source).not.toContain("withArtistPlatformStandingChrome(");
        expect(state.activeDestination).toBeNull();
      }
    }
  });

  it("renders the approved responsive chrome without production auth", () => {
    expect(shellSource).toContain('data-artist-platform-preview-chrome="standing"');
    expect(shellSource).toContain("lg:hidden");
    expect(shellSource).toContain("hidden h-dvh shrink-0 flex-col border-e lg:flex");
    expect(shellSource).toContain("hidden border-b");
    expect(shellSource).toContain("lg:block");
    expect(shellSource).toContain('aria-label="Artist preview tabs"');
    expect(shellSource).toContain("previewOnly");
    for (const label of ["Home", "Music", "Sessions", "Store"]) {
      expect(shellSource).toContain(`label: "${label}"`);
    }
  });

  it("uses standing payment and proof records while retaining focused instructions and upload", () => {
    expect(screensSource).toContain("<PaymentInstructionsScreen");
    expect(screensSource).toContain("<UploadProofScreen");
    expect(screensSource).toContain("<PaymentSummaryScreen");
    expect(screensSource).toContain("<ProofRecordScreen");
  });

  it("routes every standing platform fixture through its live component preview", () => {
    for (const [route, component] of [
      ["artist-home", "ArtistHomeDevPreview"],
      ["artist-store", "ArtistStoreCatalogDevPreview"],
      ["artist-sessions", "ArtistSessionsHubDevPreview"],
      ["artist-session-detail", "ArtistSessionDetailDevPreview"],
      ["artist-settings", "ArtistSettingsDevPreview"],
      ["artist-notifications", "ArtistNotificationCenterDevPreview"],
    ] as const) {
      expect(screensSource).toContain(`case "${route}"`);
      expect(screensSource).toContain(`<${component} />`);
      expect(standingSource).toContain(`export function ${component}`);
    }
    for (const component of [
      "ProfessionalArtistHome",
      "ProducerHero",
      "FocalProductCard",
      "QuietProductList",
      "MySessionsScreen",
      "SessionDetailScreen",
      "ArtistSettingsClient",
      "ArtistNotificationPanel",
    ]) {
      expect(standingSource).toContain(`<${component}`);
    }
    expect(shellSource).toContain("<StudioSwitcher");
  });
});
