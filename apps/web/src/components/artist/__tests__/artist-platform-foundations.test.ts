import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const artistDir = join(here, "..");
const bell = readFileSync(join(artistDir, "artist-notification-bell.tsx"), "utf8");
const actions = readFileSync(join(artistDir, "artist-notification-actions.ts"), "utf8");
const switcher = readFileSync(join(artistDir, "studio-switcher.tsx"), "utf8");
const home = readFileSync(join(artistDir, "home", "professional-home.tsx"), "utf8");
const acknowledger = readFileSync(join(artistDir, "artist-track-version-acknowledger.tsx"), "utf8");
const settings = readFileSync(join(artistDir, "settings", "artist-settings-client.tsx"), "utf8");

describe("artist notification surface", () => {
  it("provides desktop dialog and mobile sheet presentations", () => {
    expect(bell).toContain('role="dialog"');
    expect(bell).toContain('<SheetContent side="bottom"');
    expect(bell).toContain('role="tablist"');
    expect(bell).toContain('role="tabpanel"');
  });

  it("keeps read and open actions separate", () => {
    expect(bell).toContain("markArtistNotificationReadAction");
    expect(bell).toContain("openArtistNotificationAction");
    expect(bell).toContain("markAllArtistNotificationsReadAction");
    expect(bell).toContain("router.refresh()");
  });

  it("shows per-studio dots without clearing them on studio selection", () => {
    expect(switcher).toContain("notificationStudioDotIds");
    expect(switcher).toContain("<StudioActivityDot");
    expect(switcher).not.toContain("markArtistNotification");
    expect(switcher).not.toContain("acknowledgeArtist");
  });

  it("acknowledges an exact track version on song open or explicit Home play", () => {
    expect(actions).toContain("acknowledgeArtistTrackVersionAction");
    expect(acknowledger).toContain("trackVersionId");
    expect(acknowledger).toContain("acknowledgeArtistTrackVersionAction");
    expect(home).toContain('main.kind === "new_song"');
    expect(home).toContain("trackVersionId: main.id");
    expect(home).toContain("main.audio?.url");
    expect(home).not.toContain("disabled={!main.audio.url}");
  });
});

describe("professional artist Settings", () => {
  it("wires timezone, preferences, preview-first disconnect, and Past studios", () => {
    expect(settings).toContain("saveArtistTimezoneAction");
    expect(settings).toContain("saveArtistNotificationPreferencesAction");
    expect(settings).toContain("previewArtistDisconnectAction");
    expect(settings).toContain("commitArtistDisconnectAction");
    expect(settings).toContain("Past studios");
  });

  it("does not expose the browser push preference surface", () => {
    expect(settings).not.toContain("PushPreferences");
    expect(settings).not.toContain("web push");
  });
});
