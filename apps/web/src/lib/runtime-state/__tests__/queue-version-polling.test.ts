import { describe, expect, it, vi } from "vitest";

import {
  createQueueVersionChecker,
  createVisibleQueueVersionCheck,
  listenForQueueVersionActivity,
} from "../queue-version-polling";

describe("queue version polling", () => {
  it("does not refresh while the server revision is unchanged", async () => {
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion: vi.fn().mockResolvedValue("v1.current"),
      onVersionChanged,
    });

    await checker.check();

    expect(onVersionChanged).not.toHaveBeenCalled();
  });

  it("holds a new revision pending so repeated checks refresh once during the cooldown", async () => {
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion: vi.fn().mockResolvedValue("v1.changed"),
      onVersionChanged,
      retryAfterMs: 15_000,
      now: () => 1_000,
    });

    await checker.check();
    await checker.check();

    expect(onVersionChanged).toHaveBeenCalledOnce();
  });

  it("retries a pending revision after the cooldown until the server render acknowledges it", async () => {
    let now = 1_000;
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion: vi.fn().mockResolvedValue("v1.changed"),
      onVersionChanged,
      retryAfterMs: 15_000,
      now: () => now,
    });

    await checker.check();
    now += 14_999;
    await checker.check();
    now += 1;
    await checker.check();

    expect(onVersionChanged).toHaveBeenCalledTimes(2);
  });

  it("stops retrying after the server-rendered revision acknowledges the change", async () => {
    let now = 1_000;
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion: vi.fn().mockResolvedValue("v1.changed"),
      onVersionChanged,
      retryAfterMs: 15_000,
      now: () => now,
    });

    await checker.check();
    checker.setCurrentVersion("v1.changed");
    now += 15_000;
    await checker.check();

    expect(onVersionChanged).toHaveBeenCalledOnce();
  });

  it("shares an in-flight request across interval and focus checks", async () => {
    let resolveVersion: ((version: string) => void) | undefined;
    const loadVersion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion,
      onVersionChanged,
    });

    const intervalCheck = checker.check();
    const focusCheck = checker.check();
    resolveVersion?.("v1.changed");
    await Promise.all([intervalCheck, focusCheck]);

    expect(loadVersion).toHaveBeenCalledOnce();
    expect(onVersionChanged).toHaveBeenCalledOnce();
  });

  it("keeps pageshow and reconnect checks visible-only and serialized", async () => {
    let visible = false;
    let resolveVersion: ((version: string) => void) | undefined;
    const loadVersion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveVersion = resolve;
        }),
    );
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion,
      onVersionChanged: vi.fn(),
    });
    const check = createVisibleQueueVersionCheck({
      check: checker.check,
      isVisible: () => visible,
      onlyWhenVisible: true,
    });
    const windowTarget = new EventTarget();
    const stopListening = listenForQueueVersionActivity({
      check,
      documentTarget: new EventTarget(),
      refreshOnFocus: false,
      refreshOnOnline: true,
      refreshOnPageShow: true,
      refreshOnVisibilityChange: false,
      windowTarget,
    });

    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(new Event("online"));
    expect(loadVersion).not.toHaveBeenCalled();

    visible = true;
    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(new Event("online"));
    expect(loadVersion).toHaveBeenCalledOnce();

    resolveVersion?.("v1.current");
    await Promise.resolve();
    await Promise.resolve();
    stopListening();
    windowTarget.dispatchEvent(new Event("online"));

    expect(loadVersion).toHaveBeenCalledOnce();
  });

  it("ignores failed and stopped checks without disturbing rendered state", async () => {
    const onVersionChanged = vi.fn();
    const checker = createQueueVersionChecker({
      initialVersion: "v1.current",
      loadVersion: vi.fn().mockRejectedValue(new Error("offline")),
      onVersionChanged,
    });

    await expect(checker.check()).resolves.toBeUndefined();
    checker.stop();
    await expect(checker.check()).resolves.toBeUndefined();

    expect(onVersionChanged).not.toHaveBeenCalled();
  });
});
