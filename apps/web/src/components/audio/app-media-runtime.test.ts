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
    const studioPreferenceCleanup = ROOT_RUNTIME.indexOf(
      "clearArtistStudioPreferenceCookie()",
      privateCleanup,
    );
    const mediaCleanup = ROOT_RUNTIME.indexOf(
      "prepareMediaAccountExit(accountId)",
      studioPreferenceCleanup,
    );
    expect(pushBoundary).toBeGreaterThan(composedCleanup);
    expect(privateCleanup).toBeGreaterThan(pushBoundary);
    expect(studioPreferenceCleanup).toBeGreaterThan(privateCleanup);
    expect(mediaCleanup).toBeGreaterThan(studioPreferenceCleanup);
    expect(ACCOUNT_EXIT).toContain("storage: StorageLike | null = getBrowserRuntimeStorage()");
  });

  it("blocks explicit app-owned Clerk sign-out when the push boundary fails", () => {
    const safeSignOut = ROOT_RUNTIME.indexOf("export function useSafeSignOut");
    const uploadRuntime = ROOT_RUNTIME.indexOf("function AppUploadRuntime", safeSignOut);
    const safeSignOutSource = ROOT_RUNTIME.slice(safeSignOut, uploadRuntime);
    const missingIdentityGuard = ROOT_RUNTIME.indexOf("if (!accountId)", safeSignOut);
    const missingIdentityError = ROOT_RUNTIME.indexOf(
      "throw new Error(SIGN_OUT_BOUNDARY_ERROR)",
      missingIdentityGuard,
    );
    const explicitCleanup = ROOT_RUNTIME.indexOf(
      "await prepareAppAccountExit(accountId, unsubscribePushAction)",
      safeSignOut,
    );
    const boundaryError = ROOT_RUNTIME.indexOf(
      'toast(SIGN_OUT_BOUNDARY_ERROR, "error"',
      explicitCleanup,
    );
    const explicitSignOut = ROOT_RUNTIME.indexOf("await clerk.signOut(options)", boundaryError);
    expect(missingIdentityGuard).toBeGreaterThan(safeSignOut);
    expect(missingIdentityError).toBeGreaterThan(missingIdentityGuard);
    expect(explicitCleanup).toBeGreaterThan(missingIdentityError);
    expect(explicitCleanup).toBeGreaterThanOrEqual(0);
    expect(boundaryError).toBeGreaterThan(explicitCleanup);
    expect(explicitSignOut).toBeGreaterThan(boundaryError);
    expect(safeSignOutSource).not.toContain("finally");
  });

  it("intercepts built-in Clerk sign-out and stops before auth exit on boundary failure", () => {
    const builtInCapture = ROOT_RUNTIME.indexOf("const onClerkSignOut");
    const targetMatch = ROOT_RUNTIME.indexOf(
      "isClerkUserButtonSignOutTarget(event.target)",
      builtInCapture,
    );
    const preventDefault = ROOT_RUNTIME.indexOf("event.preventDefault()", targetMatch);
    const stopImmediatePropagation = ROOT_RUNTIME.indexOf(
      "event.stopImmediatePropagation()",
      preventDefault,
    );
    const builtInCleanup = ROOT_RUNTIME.indexOf(
      "await prepareAppAccountExit(accountId, unsubscribePushAction)",
      stopImmediatePropagation,
    );
    const boundaryError = ROOT_RUNTIME.indexOf(
      "toastRef.current(SIGN_OUT_BOUNDARY_ERROR",
      builtInCleanup,
    );
    const blockedReturn = ROOT_RUNTIME.indexOf("return;", boundaryError);
    const builtInSignOut = ROOT_RUNTIME.indexOf("await clerkRef.current.signOut()", blockedReturn);
    expect(builtInCapture).toBeGreaterThanOrEqual(0);
    expect(targetMatch).toBeGreaterThan(builtInCapture);
    expect(preventDefault).toBeGreaterThan(targetMatch);
    expect(stopImmediatePropagation).toBeGreaterThan(preventDefault);
    expect(builtInCleanup).toBeGreaterThan(stopImmediatePropagation);
    expect(boundaryError).toBeGreaterThan(builtInCleanup);
    expect(blockedReturn).toBeGreaterThan(boundaryError);
    expect(builtInSignOut).toBeGreaterThan(blockedReturn);
    expect(ROOT_RUNTIME).toContain('document.addEventListener("click", onClerkSignOut, true)');
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
    expect(PUSH_EXIT).toContain("if (browserUnsubscribed) {");
    expect(PUSH_EXIT).not.toContain('"server-removed"');
    expect(PUSH_EXIT).not.toContain('return confirm("delivery-suppressed")');
  });

  it("warns only for an active upload and does not claim close/relaunch continuation", () => {
    expect(ROOT_RUNTIME).toContain('"beforeunload"');
    expect(ROOT_RUNTIME).toContain("if (!hasActiveManagedUploads(accountId)) return");
    expect(ROOT_RUNTIME).toContain('data-native-update-block={active ? "active"');
    expect(ROOT_RUNTIME).not.toContain("sendBeacon");
    expect(ROOT_RUNTIME).not.toContain('"pagehide"');
  });

  it("keeps active progress in the dock and routes upload errors to one toast", () => {
    expect(ROOT_RUNTIME).toContain('aria-label="Upload activity"');
    expect(ROOT_RUNTIME).toContain('role="progressbar"');
    expect(ROOT_RUNTIME).toContain("upload.error");
    expect(ROOT_RUNTIME).toContain("retryManagedUpload");
    expect(ROOT_RUNTIME).toContain("cancelManagedUpload");
    expect(ROOT_RUNTIME).toContain('terminalFeedback !== "toast"');
    expect(ROOT_RUNTIME).toContain("const toastId = `upload-error:${upload.id}`");
    expect(ROOT_RUNTIME).toContain("id: toastId");
    expect(ROOT_RUNTIME).toContain('label: "Retry"');
  });

  it("presents staged audio as ready while the active dock still owns cancellation", () => {
    expect(ROOT_RUNTIME).toContain('upload.status === "ready"');
    expect(ROOT_RUNTIME).toContain('"Ready to save"');
    expect(ROOT_RUNTIME).toContain("managedUploadIsActive(upload)");
    expect(ROOT_RUNTIME).toContain("cancelManagedUpload(upload.id)");
  });

  it("does not render toast-owned terminal feedback in the upload dock", () => {
    expect(ROOT_RUNTIME).toContain("dismissManagedUpload");
    expect(ROOT_RUNTIME).toMatch(
      /uploads\s*\.filter\([\s\S]{0,180}?managedUploadIsActive\(upload\)[\s\S]{0,180}?terminalFeedback !== "toast"/,
    );
  });

  it("hides uploads that render their own attached progress from the dock", () => {
    expect(ROOT_RUNTIME).toContain("upload.showInDock &&");
  });

  it("gives terminal upload feedback a manual close control", () => {
    expect(ROOT_RUNTIME).toContain("dismissManagedUpload");
    expect(ROOT_RUNTIME).toContain('aria-label="Dismiss upload status"');
    expect(ROOT_RUNTIME).toContain('upload.status === "error" || upload.status === "done"');
  });

  it("gives upload actions coarse touch targets and clears the audio dock", () => {
    expect(ROOT_RUNTIME.match(/sk-press inline-flex min-h-11 min-w-11/g)).toHaveLength(3);
    expect(ROOT_RUNTIME).toContain("playback.track");
    expect(ROOT_RUNTIME).toContain(
      "bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-[6.5rem]",
    );
  });
});
