import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT_RUNTIME = readFileSync(new URL("./app-media-runtime.tsx", import.meta.url), "utf8");
const PLAYBACK_RUNTIME = readFileSync(new URL("./playback-runtime.tsx", import.meta.url), "utf8");
const PERSISTENT_PLAYER = readFileSync(new URL("./persistent-player.tsx", import.meta.url), "utf8");
const ROOT_LAYOUT = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
const ACCOUNT_EXIT = readFileSync(
  new URL("../../lib/runtime-state/account-exit.ts", import.meta.url),
  "utf8",
);
const PUBLIC_PLAYER = readFileSync(
  new URL("../join/join-mini-player.tsx", import.meta.url),
  "utf8",
);

describe("SK-110 root media runtime", () => {
  it("mounts one app media runtime immediately after the native runtime", () => {
    expect(ROOT_LAYOUT.match(/<NativeAppRuntime \/>/g)).toHaveLength(1);
    expect(ROOT_LAYOUT.match(/<AppMediaRuntime \/>/g)).toHaveLength(1);
    expect(ROOT_LAYOUT).toMatch(/<NativeAppRuntime \/>\s*<AppMediaRuntime \/>/);
  });

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

  it("clears private continuity state before preparing media account exit", () => {
    expect(ROOT_RUNTIME).toContain("export async function prepareMediaAccountExit");
    const privateCleanup = ROOT_RUNTIME.indexOf("clearAccountPrivateRuntimeState(accountId)");
    const mediaCleanup = ROOT_RUNTIME.indexOf(
      "return prepareMediaAccountExit(accountId)",
      privateCleanup,
    );
    expect(privateCleanup).toBeGreaterThanOrEqual(0);
    expect(mediaCleanup).toBeGreaterThan(privateCleanup);
    expect(ACCOUNT_EXIT).toContain("storage: StorageLike | null = getBrowserRuntimeStorage()");
  });

  it("waits for composed cleanup before explicit app-owned Clerk sign-out", () => {
    const explicitCleanup = ROOT_RUNTIME.indexOf(
      "if (user?.id) await prepareAppAccountExit(user.id)",
    );
    const explicitSignOut = ROOT_RUNTIME.indexOf("await clerk.signOut(options)", explicitCleanup);
    expect(explicitCleanup).toBeGreaterThanOrEqual(0);
    expect(explicitSignOut).toBeGreaterThan(explicitCleanup);
  });

  it("intercepts built-in Clerk sign-out and waits for the same composed cleanup", () => {
    const builtInCapture = ROOT_RUNTIME.indexOf(
      'data-localization-key="userButtonPopoverActionSignOut"',
    );
    const builtInCleanup = ROOT_RUNTIME.indexOf(
      "void prepareAppAccountExit(accountId)",
      builtInCapture,
    );
    const builtInSignOut = ROOT_RUNTIME.indexOf(".then(() => clerk.signOut())", builtInCleanup);
    expect(builtInCapture).toBeGreaterThanOrEqual(0);
    expect(builtInCleanup).toBeGreaterThan(builtInCapture);
    expect(builtInSignOut).toBeGreaterThan(builtInCleanup);
  });

  it("hides the previous account before running its composed switch cleanup", () => {
    const visibleAccountSwitch = ROOT_RUNTIME.indexOf("setUploadRuntimeAccountId(accountId)");
    const previousAccountCleanup = ROOT_RUNTIME.indexOf(
      "void prepareAppAccountExit(previous)",
      visibleAccountSwitch,
    );
    expect(visibleAccountSwitch).toBeGreaterThanOrEqual(0);
    expect(previousAccountCleanup).toBeGreaterThan(visibleAccountSwitch);
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

  it("gives upload actions coarse touch targets and clears the audio dock", () => {
    expect(ROOT_RUNTIME.match(/sk-press inline-flex min-h-11 min-w-11/g)).toHaveLength(2);
    expect(ROOT_RUNTIME).toContain("playback.track");
    expect(ROOT_RUNTIME).toContain(
      "bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-[6.5rem]",
    );
  });
});
