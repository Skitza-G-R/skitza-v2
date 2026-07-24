import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT_RUNTIME = readFileSync(new URL("./app-media-runtime.tsx", import.meta.url), "utf8");
const PLAYBACK_RUNTIME = readFileSync(new URL("./playback-runtime.tsx", import.meta.url), "utf8");
const PERSISTENT_PLAYER = readFileSync(new URL("./persistent-player.tsx", import.meta.url), "utf8");
const PUBLIC_PLAYER = readFileSync(
  new URL("../join/join-mini-player.tsx", import.meta.url),
  "utf8",
);

describe("SK-110 root media runtime", () => {
  it("exports one exact root adapter and keeps route players presentation-only", () => {
    expect(ROOT_RUNTIME).toContain("export function AppMediaRuntime");
    expect(ROOT_RUNTIME).toContain("<AppPlaybackRuntime");
    expect(PLAYBACK_RUNTIME).toContain("data-skitza-playback-engine");
    expect(PLAYBACK_RUNTIME.match(/<audio\s+ref=/g)).toHaveLength(1);
    expect(PERSISTENT_PLAYER).not.toMatch(/<audio\s+ref=/);
    expect(PUBLIC_PLAYER).not.toMatch(/<audio\s+ref=/);
  });

  it("never reuses a resolved source across an account or track boundary", () => {
    expect(PLAYBACK_RUNTIME).toContain("resolvedSource.accountId !== playbackAccountId");
    expect(PLAYBACK_RUNTIME).toContain("resolvedSource.trackId !== track.id");
    expect(PLAYBACK_RUNTIME).toContain("resolvedSource.canonicalUrl !== track.audioUrl");
  });

  it("installs Media Session metadata, artwork, position, and guarded actions", () => {
    expect(PLAYBACK_RUNTIME).toContain("new MediaMetadata");
    expect(PLAYBACK_RUNTIME).toContain("artwork: mediaArtwork(track)");
    expect(PLAYBACK_RUNTIME).toContain("setPositionState");
    for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"]) {
      expect(PLAYBACK_RUNTIME).toContain(`installAction("${action}"`);
    }
    expect(PLAYBACK_RUNTIME).toMatch(
      /try \{[\s\S]*?mediaSession\.setActionHandler\(action, handler\)[\s\S]*?catch/,
    );
    expect(PLAYBACK_RUNTIME).toMatch(
      /for \(const action of installedActions\)[\s\S]*?try \{[\s\S]*?setActionHandler\(action, null\)[\s\S]*?catch/,
    );
  });

  it("waits for account cleanup before every app-owned Clerk sign-out", () => {
    const explicitCleanup = ROOT_RUNTIME.indexOf("if (user?.id) await prepareAccountExit(user.id)");
    const explicitSignOut = ROOT_RUNTIME.indexOf("await clerk.signOut(options)", explicitCleanup);
    expect(explicitCleanup).toBeGreaterThanOrEqual(0);
    expect(explicitSignOut).toBeGreaterThan(explicitCleanup);

    const builtInCleanup = ROOT_RUNTIME.indexOf("void prepareAccountExit(accountId)");
    const builtInSignOut = ROOT_RUNTIME.indexOf(".then(() => clerk.signOut())", builtInCleanup);
    expect(ROOT_RUNTIME).toContain('data-localization-key="userButtonPopoverActionSignOut"');
    expect(builtInSignOut).toBeGreaterThan(builtInCleanup);
  });

  it("warns only for an active upload and does not claim close/relaunch continuation", () => {
    expect(ROOT_RUNTIME).toContain('"beforeunload"');
    expect(ROOT_RUNTIME).toContain("if (!hasActiveManagedUploads(accountId)) return");
    expect(ROOT_RUNTIME).toContain('data-native-update-block={active ? "active"');
    expect(ROOT_RUNTIME).not.toContain("sendBeacon");
    expect(ROOT_RUNTIME).not.toContain('"pagehide"');
  });

  it("surfaces persistent progress, error, retry, and stop controls", () => {
    expect(ROOT_RUNTIME).toContain('aria-label="Upload activity"');
    expect(ROOT_RUNTIME).toContain('role="progressbar"');
    expect(ROOT_RUNTIME).toContain("upload.error");
    expect(ROOT_RUNTIME).toContain("retryManagedUpload");
    expect(ROOT_RUNTIME).toContain("cancelManagedUpload");
  });
});
