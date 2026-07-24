import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrowserPushSubscription,
  getPushAccountBoundaryGeneration,
  PushAccountBoundaryError,
  pushAccountBoundaryAllowsDelivery,
  resumeBrowserPushDelivery,
  runTrackedPushSubscriptionWrite,
  suppressBrowserPushDelivery,
} from "../browser-subscription";

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
      notifyBoundary: vi.fn(),
      notifyCleared: vi.fn(),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push account-exit cleanup", () => {
  it("confirms explicit sign-out when browser and owned-row removal both succeed", async () => {
    const test = harness();
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "browser-unsubscribed",
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
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

  it("blocks the cross-tab late write race when browser unsubscribe returns false after server removal", async () => {
    const test = harness({ unsubscribe: false });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("blocks explicit sign-out when the server request succeeds without removing the owned row", async () => {
    const test = harness({ unsubscribe: false });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: false as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("orders explicit removal after an already-started subscribe write", async () => {
    const timeline: string[] = [];
    let resolveSave: ((result: { ok: true }) => void) | undefined;
    const save = new Promise<{ ok: true }>((resolve) => {
      resolveSave = resolve;
    });
    const trackedSave = runTrackedPushSubscriptionWrite(() =>
      save.then((result) => {
        timeline.push("subscribe-committed");
        return result;
      }),
    );
    const test = harness({ unsubscribe: false });
    const removeOwned = vi.fn(() => {
      timeline.push("owned-row-removed");
      return Promise.resolve({ ok: true as const, removed: true as const });
    });

    const exit = clearBrowserPushSubscription(removeOwned, test.adapter);
    await Promise.resolve();
    expect(test.adapter.getSubscription).not.toHaveBeenCalled();
    expect(removeOwned).not.toHaveBeenCalled();

    resolveSave?.({ ok: true });
    await expect(exit).rejects.toBeInstanceOf(PushAccountBoundaryError);
    await expect(trackedSave).resolves.toEqual({ ok: true });

    expect(timeline).toEqual(["subscribe-committed", "owned-row-removed"]);
    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("blocks explicit sign-out when subscription lookup fails", async () => {
    const test = harness({ lookupError: true });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(removeOwned).not.toHaveBeenCalled();
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("blocks explicit sign-out when unsubscribe rejects and the server returns ok false", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: "request failed" }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("blocks explicit sign-out when unsubscribe rejects after server removal", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("does not let shared suppression authorize an account switch when lookup fails", async () => {
    const test = harness({ lookupError: true });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("does not let shared suppression authorize an account switch after unsubscribe returns false", async () => {
    const test = harness({ unsubscribe: false });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("does not let shared suppression authorize an account switch after unsubscribe rejects", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
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

  it("prevents a pending old-account save from resuming delivery after a boundary", async () => {
    const staleGeneration = getPushAccountBoundaryGeneration();
    const test = harness({ unsubscribe: false });
    const deleteMarker = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("caches", {
      open: vi.fn(() =>
        Promise.resolve({
          delete: deleteMarker,
          match: vi.fn(() => Promise.resolve(undefined)),
        }),
      ),
    });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );
    await expect(
      resumeBrowserPushDelivery(() => pushAccountBoundaryAllowsDelivery(staleGeneration)),
    ).resolves.toBe(false);

    expect(deleteMarker).not.toHaveBeenCalled();
  });

  it("treats an absent browser subscription as a confirmed boundary", async () => {
    const test = harness({ noSubscription: true });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "no-subscription",
    );

    expect(removeOwned).not.toHaveBeenCalled();
    expect(test.subscription.unsubscribe).not.toHaveBeenCalled();
    expect(test.adapter.suppressDelivery).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });
});

describe("service-worker suppression capability", () => {
  it("accepts a marker only after the active worker proves support", async () => {
    const cache = {
      put: vi.fn(() => Promise.resolve(undefined)),
      match: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    };
    const markerAwareActive = {
      postMessage: vi.fn((_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
        });
        transfer[0]?.close();
      }),
    };
    vi.stubGlobal("MessageChannel", MessageChannel);
    vi.stubGlobal("caches", {
      open: vi.fn(() => Promise.resolve(cache)),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(() =>
          Promise.resolve({
            active: markerAwareActive,
            waiting: null,
          }),
        ),
      },
    });

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(true);

    expect(markerAwareActive.postMessage).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("rejects a marker when only the waiting worker understands suppression", async () => {
    const test = harness({ unsubscribe: false });
    const cache = {
      put: vi.fn(() => Promise.resolve(undefined)),
      match: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    };
    const oldActive = {
      postMessage: vi.fn((_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.close();
      }),
    };
    const markerAwareWaiting = {
      postMessage: vi.fn((_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
        });
      }),
    };
    vi.stubGlobal("MessageChannel", MessageChannel);
    vi.stubGlobal("caches", {
      open: vi.fn(() => Promise.resolve(cache)),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(() =>
          Promise.resolve({
            active: oldActive,
            waiting: markerAwareWaiting,
          }),
        ),
      },
    });

    await expect(
      clearBrowserPushSubscription(null, {
        ...test.adapter,
        suppressDelivery: () => suppressBrowserPushDelivery(0),
      }),
    ).rejects.toBeInstanceOf(PushAccountBoundaryError);

    expect(oldActive.postMessage).toHaveBeenCalledOnce();
    expect(markerAwareWaiting.postMessage).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();

    await clearBrowserPushSubscription(null, harness({ noSubscription: true }).adapter);
  });
});
