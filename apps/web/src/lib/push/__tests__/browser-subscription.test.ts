import { describe, expect, it, vi } from "vitest";

import { clearBrowserPushSubscription, PushAccountBoundaryError } from "../browser-subscription";

type HarnessOptions = Readonly<{
  lookupError?: boolean;
  noSubscription?: boolean;
  unsubscribe?: boolean | Error;
  suppressDelivery?: boolean | Error;
}>;

function harness(options: HarnessOptions = {}) {
  const subscription = {
    endpoint: "https://push.example.test/device",
    unsubscribe: vi.fn(() =>
      options.unsubscribe instanceof Error
        ? Promise.reject(options.unsubscribe)
        : Promise.resolve(options.unsubscribe ?? true),
    ),
  };
  const suppressDelivery = vi.fn(() =>
    options.suppressDelivery instanceof Error
      ? Promise.reject(options.suppressDelivery)
      : Promise.resolve(options.suppressDelivery ?? true),
  );
  return {
    subscription,
    adapter: {
      getSubscription: vi.fn(() =>
        options.lookupError
          ? Promise.reject(new Error("lookup failed"))
          : Promise.resolve(options.noSubscription ? null : subscription),
      ),
      suppressDelivery,
      notifyCleared: vi.fn(),
    },
  };
}

describe("push account-exit cleanup", () => {
  it("confirms explicit sign-out when browser and owned-row removal both succeed", async () => {
    const test = harness();
    const removeOwned = vi.fn(() => Promise.resolve({ ok: true as const }));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "browser-unsubscribed",
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("accepts confirmed browser invalidation when owned-row removal rejects", async () => {
    const test = harness();
    const removeOwned = vi.fn(() => Promise.reject(new Error("offline")));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "browser-unsubscribed",
    );

    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("accepts confirmed server removal when browser unsubscribe returns false", async () => {
    const test = harness({ unsubscribe: false });
    const removeOwned = vi.fn(() => Promise.resolve({ ok: true as const }));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "server-removed",
    );

    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("blocks explicit sign-out when subscription lookup fails", async () => {
    const test = harness({ lookupError: true });
    const removeOwned = vi.fn(() => Promise.resolve({ ok: true as const }));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(removeOwned).not.toHaveBeenCalled();
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("blocks explicit sign-out when unsubscribe rejects and the server returns ok false", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });
    const removeOwned = vi.fn(() => Promise.resolve({ ok: false as const }));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("uses durable local suppression when account-switch lookup fails", async () => {
    const test = harness({ lookupError: true });

    await expect(clearBrowserPushSubscription(null, test.adapter)).resolves.toBe(
      "delivery-suppressed",
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("uses durable local suppression when account-switch unsubscribe returns false", async () => {
    const test = harness({ unsubscribe: false });

    await expect(clearBrowserPushSubscription(null, test.adapter)).resolves.toBe(
      "delivery-suppressed",
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("uses durable local suppression when account-switch unsubscribe rejects", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });

    await expect(clearBrowserPushSubscription(null, test.adapter)).resolves.toBe(
      "delivery-suppressed",
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it("blocks an account switch when unsubscribe and durable suppression both fail", async () => {
    const test = harness({
      unsubscribe: new Error("unsubscribe failed"),
      suppressDelivery: false,
    });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("treats an absent browser subscription as a confirmed boundary", async () => {
    const test = harness({ noSubscription: true });
    const removeOwned = vi.fn(() => Promise.resolve({ ok: true as const }));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "no-subscription",
    );

    expect(removeOwned).not.toHaveBeenCalled();
    expect(test.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });
});
