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
const PUSH_EXIT = readFileSync(
  new URL("../../lib/push/browser-subscription.ts", import.meta.url),
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

  it("confirms the push boundary before clearing private account state", () => {
    expect(ROOT_RUNTIME).toContain("export async function prepareMediaAccountExit");
    const composedCleanup = ROOT_RUNTIME.indexOf("async function prepareAppAccountExit");
    const pushBoundary = ROOT_RUNTIME.indexOf(
      "await clearBrowserPushSubscription(removeOwnedPush)",
      composedCleanup,
    );
    const privateCleanup = ROOT_RUNTIME.indexOf(
      "clearAccountPrivateRuntimeState(accountId)",
      pushBoundary,
    );
    const mediaCleanup = ROOT_RUNTIME.indexOf("prepareMediaAccountExit(accountId)", privateCleanup);
    expect(pushBoundary).toBeGreaterThan(composedCleanup);
    expect(privateCleanup).toBeGreaterThan(pushBoundary);
    expect(mediaCleanup).toBeGreaterThan(privateCleanup);
    expect(ACCOUNT_EXIT).toContain("storage: StorageLike | null = getBrowserRuntimeStorage()");
  });

  it("blocks explicit app-owned Clerk sign-out when the push boundary fails", () => {
    const safeSignOut = ROOT_RUNTIME.indexOf("export function useSafeSignOut");
    const uploadRuntime = ROOT_RUNTIME.indexOf("function AppUploadRuntime", safeSignOut);
    const safeSignOutSource = ROOT_RUNTIME.slice(safeSignOut, uploadRuntime);
    const explicitCleanup = ROOT_RUNTIME.indexOf(
      "if (user?.id) await prepareAppAccountExit(user.id, unsubscribePushAction)",
      safeSignOut,
    );
    const boundaryError = ROOT_RUNTIME.indexOf(
      'toast(SIGN_OUT_BOUNDARY_ERROR, "error"',
      explicitCleanup,
    );
    const explicitSignOut = ROOT_RUNTIME.indexOf("await clerk.signOut(options)", boundaryError);
    expect(explicitCleanup).toBeGreaterThanOrEqual(0);
    expect(boundaryError).toBeGreaterThan(explicitCleanup);
    expect(explicitSignOut).toBeGreaterThan(boundaryError);
    expect(safeSignOutSource).not.toContain("finally");
  });

  it("intercepts built-in Clerk sign-out and stops before auth exit on boundary failure", () => {
    const builtInCapture = ROOT_RUNTIME.indexOf(
      'data-localization-key="userButtonPopoverActionSignOut"',
    );
    const builtInCleanup = ROOT_RUNTIME.indexOf(
      "await prepareAppAccountExit(accountId, unsubscribePushAction)",
      builtInCapture,
    );
    const boundaryError = ROOT_RUNTIME.indexOf(
      "toastRef.current(SIGN_OUT_BOUNDARY_ERROR",
      builtInCleanup,
    );
    const blockedReturn = ROOT_RUNTIME.indexOf("return;", boundaryError);
    const builtInSignOut = ROOT_RUNTIME.indexOf("await clerkRef.current.signOut()", blockedReturn);
    expect(builtInCapture).toBeGreaterThanOrEqual(0);
    expect(builtInCleanup).toBeGreaterThan(builtInCapture);
    expect(boundaryError).toBeGreaterThan(builtInCleanup);
    expect(blockedReturn).toBeGreaterThan(boundaryError);
    expect(builtInSignOut).toBeGreaterThan(blockedReturn);
  });

  it("keeps the new account hidden until switch invalidation is confirmed", () => {
    const switchBoundary = ROOT_RUNTIME.indexOf("if (previous && previous !== accountId)");
    const hiddenAccount = ROOT_RUNTIME.indexOf("setUploadRuntimeAccountId(null)", switchBoundary);
    const previousAccountCleanup = ROOT_RUNTIME.indexOf(
      "void prepareAppAccountExit(previous, null)",
      hiddenAccount,
    );
    const visibleAccountSwitch = ROOT_RUNTIME.indexOf(
      "setUploadRuntimeAccountId(accountId)",
      previousAccountCleanup,
    );
    expect(hiddenAccount).toBeGreaterThan(switchBoundary);
    expect(previousAccountCleanup).toBeGreaterThan(hiddenAccount);
    expect(visibleAccountSwitch).toBeGreaterThan(previousAccountCleanup);
    expect(ROOT_RUNTIME).toContain("previous && accountId === null");
    expect(ROOT_RUNTIME).toContain("void clerkRef.current.signOut().catch");
    expect(PUSH_EXIT).toContain("await adapter.suppressDelivery()");
    expect(PUSH_EXIT).toContain("Fail-closed server");
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
