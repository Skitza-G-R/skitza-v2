import { describe, expect, it, vi } from "vitest";

import { clearBrowserPushSubscription } from "../browser-subscription";

function adapter() {
  const subscription = {
    endpoint: "https://push.example.test/device",
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  return {
    subscription,
    adapter: {
      getSubscription: vi.fn(() => Promise.resolve(subscription)),
      notifyCleared: vi.fn(),
    },
  };
}

describe("push account-exit cleanup", () => {
  it("removes the owned row while auth is live and unsubscribes the browser", async () => {
    const harness = adapter();
    const removeOwned = vi.fn(() => Promise.resolve({ ok: true as const }));

    await clearBrowserPushSubscription(removeOwned, harness.adapter);

    expect(removeOwned).toHaveBeenCalledWith(harness.subscription.endpoint);
    expect(harness.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("unsubscribes locally after an identity switch without weakening ownership", async () => {
    const harness = adapter();

    await clearBrowserPushSubscription(null, harness.adapter);

    expect(harness.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("still invalidates the browser when owned-row cleanup fails", async () => {
    const harness = adapter();
    const removeOwned = vi.fn(() => Promise.reject(new Error("offline")));

    await expect(
      clearBrowserPushSubscription(removeOwned, harness.adapter),
    ).resolves.toBeUndefined();
    expect(harness.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("does nothing when this browser has no subscription", async () => {
    const notifyCleared = vi.fn();
    const removeOwned = vi.fn();

    await clearBrowserPushSubscription(removeOwned, {
      getSubscription: vi.fn(() => Promise.resolve(null)),
      notifyCleared,
    });

    expect(removeOwned).not.toHaveBeenCalled();
    expect(notifyCleared).not.toHaveBeenCalled();
  });
});
