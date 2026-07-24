import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrowserPushSubscription,
  closeDisplayedSkitzaNotifications,
  getPushAccountBoundaryGeneration,
  PUSH_DELIVERY_BOUNDARY_NONCE_HEADER,
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
  notificationCleanup?: boolean | Error;
}>;

class MockServiceWorker extends EventTarget {
  state: ServiceWorkerState;

  constructor(
    state: ServiceWorkerState,
    readonly postMessage: (
      message: unknown,
      transfer?: readonly MessagePort[],
    ) => void,
  ) {
    super();
    this.state = state;
  }

  transitionTo(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

const ACTIVE_VERSION = "2026-07-24-sk116-4";
const BOUNDARY_NONCE = "11111111-2222-4333-8444-555555555555";
const OTHER_BOUNDARY_NONCE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function messageRecord(message: unknown): Readonly<Record<string, unknown>> {
  return typeof message === "object" && message !== null
    ? (message as Record<string, unknown>)
    : {};
}

function createNonceCache(onPut?: () => void) {
  let marker: Response | undefined;
  return {
    cache: {
      put: vi.fn((_input: unknown, response: Response) => {
        marker = response;
        onPut?.();
        return Promise.resolve(undefined);
      }),
      match: vi.fn(() => Promise.resolve(marker)),
    },
    marker: () => marker,
    replaceMarker(nonce: string | null) {
      marker =
        nonce === null
          ? undefined
          : new Response(null, {
              status: 204,
              headers: { [PUSH_DELIVERY_BOUNDARY_NONCE_HEADER]: nonce },
            });
    },
  };
}

function stubSuppressionBrowser(
  registration: object,
  cache: ReturnType<typeof createNonceCache>["cache"],
  nonce = BOUNDARY_NONCE,
): EventTarget {
  const serviceWorkers = new EventTarget() as EventTarget & {
    getRegistration: ReturnType<typeof vi.fn>;
  };
  serviceWorkers.getRegistration = vi.fn(() => Promise.resolve(registration));
  vi.stubGlobal("MessageChannel", MessageChannel);
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => nonce),
  });
  vi.stubGlobal("caches", {
    open: vi.fn(() => Promise.resolve(cache)),
  });
  vi.stubGlobal("navigator", {
    serviceWorker: serviceWorkers,
  });
  return serviceWorkers;
}

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
  const closeDisplayedNotifications = vi.fn(() =>
    options.notificationCleanup instanceof Error
      ? Promise.reject(options.notificationCleanup)
      : Promise.resolve(options.notificationCleanup ?? true),
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
      closeDisplayedNotifications,
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
    const timeline: string[] = [];
    test.adapter.suppressDelivery.mockImplementation(() => {
      timeline.push("suppression-confirmed");
      return Promise.resolve(true);
    });
    test.adapter.closeDisplayedNotifications.mockImplementation(() => {
      timeline.push("notifications-closed");
      return Promise.resolve(true);
    });
    test.adapter.notifyCleared.mockImplementation(() => {
      timeline.push("boundary-confirmed");
    });
    const removeOwned = vi.fn(() =>
      Promise.resolve({ ok: true as const, removed: true as const }),
    );

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "browser-unsubscribed",
    );

    expect(removeOwned).toHaveBeenCalledWith(test.subscription.endpoint);
    expect(test.subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.closeDisplayedNotifications).toHaveBeenCalledOnce();
    expect(test.adapter.notifyBoundary).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
    expect(timeline).toEqual([
      "suppression-confirmed",
      "notifications-closed",
      "boundary-confirmed",
    ]);
  });

  it("accepts confirmed browser invalidation when owned-row removal rejects", async () => {
    const test = harness();
    const removeOwned = vi.fn(() => Promise.reject(new Error("offline")));

    await expect(clearBrowserPushSubscription(removeOwned, test.adapter)).resolves.toBe(
      "browser-unsubscribed",
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
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
    expect(test.adapter.closeDisplayedNotifications).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("does not let shared suppression authorize an account switch after unsubscribe returns false", async () => {
    const test = harness({ unsubscribe: false });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.closeDisplayedNotifications).not.toHaveBeenCalled();
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
  });

  it("does not let shared suppression authorize an account switch after unsubscribe rejects", async () => {
    const test = harness({ unsubscribe: new Error("unsubscribe failed") });

    await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
      PushAccountBoundaryError,
    );

    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.closeDisplayedNotifications).not.toHaveBeenCalled();
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

  it("resumes delivery only after a new subscription is confirmed", async () => {
    let suppressed = true;
    let subscriptionConfirmed = false;
    const deleteMarker = vi.fn(() => {
      suppressed = false;
      return Promise.resolve(true);
    });
    vi.stubGlobal("caches", {
      open: vi.fn(() =>
        Promise.resolve({
          delete: deleteMarker,
          match: vi.fn(() =>
            Promise.resolve(
              suppressed ? new Response(null, { status: 204 }) : undefined,
            ),
          ),
        }),
      ),
    });

    await expect(
      resumeBrowserPushDelivery(() => subscriptionConfirmed),
    ).resolves.toBe(false);
    expect(deleteMarker).not.toHaveBeenCalled();

    subscriptionConfirmed = true;
    await expect(
      resumeBrowserPushDelivery(() => subscriptionConfirmed),
    ).resolves.toBe(true);
    expect(deleteMarker).toHaveBeenCalledOnce();
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
    expect(test.adapter.closeDisplayedNotifications).toHaveBeenCalledOnce();
    expect(test.adapter.suppressDelivery).toHaveBeenCalledOnce();
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it.each([false, new Error("suppression failed")])(
    "fails closed when the delivery fence cannot be confirmed",
    async (suppressDelivery) => {
      const test = harness({ noSubscription: true, suppressDelivery });

      await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
        PushAccountBoundaryError,
      );

      expect(test.adapter.closeDisplayedNotifications).not.toHaveBeenCalled();
      expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
    },
  );

  it("awaits displayed-notification cleanup before confirming the boundary", async () => {
    let confirmCleanup: ((clean: boolean) => void) | undefined;
    const test = harness();
    test.adapter.closeDisplayedNotifications.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          confirmCleanup = resolve;
        }),
    );

    const exit = clearBrowserPushSubscription(null, test.adapter);
    await vi.waitFor(() => {
      expect(test.adapter.closeDisplayedNotifications).toHaveBeenCalledOnce();
    });
    expect(test.adapter.notifyCleared).not.toHaveBeenCalled();

    confirmCleanup?.(true);
    await expect(exit).resolves.toBe("browser-unsubscribed");
    expect(test.adapter.notifyCleared).toHaveBeenCalledOnce();
  });

  it.each([false, new Error("notification lookup failed")])(
    "fails closed when displayed-notification cleanup cannot be confirmed",
    async (notificationCleanup) => {
      const test = harness({ noSubscription: true, notificationCleanup });

      await expect(clearBrowserPushSubscription(null, test.adapter)).rejects.toBeInstanceOf(
        PushAccountBoundaryError,
      );

      expect(test.adapter.notifyCleared).not.toHaveBeenCalled();
    },
  );

  it("closes only displayed notifications with the Skitza tag prefix", async () => {
    const closeSkitza = vi.fn();
    const closeOther = vi.fn();
    const skitzaNotification = { tag: "skitza-comment", close: closeSkitza };
    const otherNotification = { tag: "calendar-reminder", close: closeOther };
    const getNotifications = vi
      .fn()
      .mockResolvedValueOnce([skitzaNotification, otherNotification])
      .mockResolvedValueOnce([otherNotification]);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(() =>
          Promise.resolve({
            pushManager: { getSubscription: vi.fn(() => Promise.resolve(null)) },
            getNotifications,
          }),
        ),
      },
    });

    await expect(closeDisplayedSkitzaNotifications()).resolves.toBe(true);

    expect(getNotifications).toHaveBeenCalledTimes(2);
    expect(closeSkitza).toHaveBeenCalledOnce();
    expect(closeOther).not.toHaveBeenCalled();
  });

  it("fails closed when a Skitza notification remains displayed after close", async () => {
    const close = vi.fn();
    const notification = { tag: "skitza-payment", close };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(() =>
          Promise.resolve({
            pushManager: { getSubscription: vi.fn(() => Promise.resolve(null)) },
            getNotifications: vi.fn(() => Promise.resolve([notification])),
          }),
        ),
      },
    });

    await expect(closeDisplayedSkitzaNotifications()).resolves.toBe(false);

    expect(close).toHaveBeenCalledOnce();
  });
});

describe("service-worker suppression capability", () => {
  it("binds the active worker flush to the exact marker nonce and version", async () => {
    const cacheState = createNonceCache();
    const messages: unknown[] = [];
    const active = new MockServiceWorker(
      "activated",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        messages.push(message);
        const data = messageRecord(message);
        transfer[0]?.postMessage(
          data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY"
            ? {
                type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
                supported: true,
                flushSupported: true,
                version: ACTIVE_VERSION,
              }
            : {
                type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
                flushed: true,
                version: data.version,
                nonce: data.nonce,
              },
        );
        transfer[0]?.close();
      },
    );
    const registration = { active, waiting: null };
    stubSuppressionBrowser(registration, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(true);

    expect(messages).toEqual([
      { type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY" },
      {
        type: "SKITZA_PUSH_SUPPRESSION_FLUSH",
        version: ACTIVE_VERSION,
        nonce: BOUNDARY_NONCE,
      },
    ]);
    expect(
      cacheState
        .marker()
        ?.headers.get(PUSH_DELIVERY_BOUNDARY_NONCE_HEADER),
    ).toBe(BOUNDARY_NONCE);
  });

  it("fails before writing a marker when a marker-only active has no waiting worker", async () => {
    const cacheState = createNonceCache();
    const active = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
          version: "2026-07-24-sk116-3",
        });
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser({ active, waiting: null }, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(false);

    expect(cacheState.cache.put).not.toHaveBeenCalled();
  });

  it("drains an SK116-3 in-flight display before the exact SK116-4 flush", async () => {
    const timeline: string[] = ["old-display-started"];
    let finishOldDisplay: (() => void) | undefined;
    const oldDisplay = new Promise<void>((resolve) => {
      finishOldDisplay = resolve;
    });
    const cacheState = createNonceCache(() => {
      timeline.push("marker-written");
    });
    const oldActive = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
          version: "2026-07-24-sk116-3",
        });
        transfer[0]?.close();
      },
    );
    type MutableRegistration = {
      active: MockServiceWorker;
      waiting: MockServiceWorker | null;
      pushManager: {
        getSubscription(): Promise<{
          endpoint: string;
          unsubscribe(): Promise<boolean>;
        }>;
      };
      getNotifications(): Promise<never[]>;
    };
    const waitingMessages: unknown[] = [];
    const waiting = new MockServiceWorker(
      "installed",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        waitingMessages.push(message);
        const data = messageRecord(message);
        if (data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY") {
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
            supported: true,
            flushSupported: true,
            version: ACTIVE_VERSION,
          });
          transfer[0]?.close();
          return;
        }
        if (data.type === "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT") {
          timeline.push("exit-activation-requested");
          transfer[0]?.postMessage({
            type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
            activated: true,
            version: data.version,
            nonce: data.nonce,
          });
          transfer[0]?.close();
          void oldDisplay.then(() => {
            timeline.push("old-display-finished");
            oldActive.transitionTo("redundant");
            registration.active = waiting;
            registration.waiting = null;
            waiting.transitionTo("activated");
          });
          return;
        }
        if (data.type === "SKITZA_PUSH_SUPPRESSION_FLUSH") {
          timeline.push("new-worker-flushed");
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
            flushed: true,
            version: data.version,
            nonce: data.nonce,
          });
          transfer[0]?.close();
        }
      },
    );
    const subscription = {
      endpoint: "https://push.example.test/sk116-3-device",
      unsubscribe: vi.fn(() => {
        timeline.push("browser-unsubscribed");
        return Promise.resolve(true);
      }),
    };
    const registration: MutableRegistration = {
      active: oldActive,
      waiting,
      pushManager: {
        getSubscription: vi.fn(() => Promise.resolve(subscription)),
      },
      getNotifications: vi.fn(() => Promise.resolve([])),
    };
    stubSuppressionBrowser(registration, cacheState.cache);
    const removeOwned = vi.fn(() => {
      timeline.push("owned-row-removed");
      return Promise.resolve({ ok: true as const, removed: true as const });
    });

    let boundaryCompleted = false;
    const boundary = clearBrowserPushSubscription(removeOwned).then((result) => {
      boundaryCompleted = true;
      return result;
    });
    await vi.waitFor(() => {
      expect(timeline).toContain("exit-activation-requested");
    });
    expect(boundaryCompleted).toBe(false);
    expect(timeline.indexOf("browser-unsubscribed")).toBeLessThan(
      timeline.indexOf("marker-written"),
    );
    expect(timeline.indexOf("marker-written")).toBeLessThan(
      timeline.indexOf("exit-activation-requested"),
    );

    finishOldDisplay?.();
    await expect(boundary).resolves.toBe("browser-unsubscribed");
    expect(timeline.indexOf("old-display-finished")).toBeLessThan(
      timeline.indexOf("new-worker-flushed"),
    );
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(removeOwned).toHaveBeenCalledWith(subscription.endpoint);
    expect(oldActive.state).toBe("redundant");
    expect(waiting.state).toBe("activated");
    expect(registration.active).toBe(waiting);
    expect(waitingMessages.map((message) => messageRecord(message).type)).toEqual(
      [
        "SKITZA_PUSH_SUPPRESSION_CAPABILITY",
        "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT",
        "SKITZA_PUSH_SUPPRESSION_CAPABILITY",
        "SKITZA_PUSH_SUPPRESSION_FLUSH",
      ],
    );
  });

  it("hands a capability-none legacy active worker to an exact waiting worker", async () => {
    const timeline: string[] = [];
    const cacheState = createNonceCache(() => {
      timeline.push("marker-written");
    });
    const oldActive = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.close();
      },
    );
    const waitingMessages: unknown[] = [];
    const waiting = new MockServiceWorker(
      "installed",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        waitingMessages.push(message);
        const data = messageRecord(message);
        if (data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY") {
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
            supported: true,
            flushSupported: true,
            version: ACTIVE_VERSION,
          });
        } else if (data.type === "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT") {
          transfer[0]?.postMessage({
            type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
            activated: true,
            version: data.version,
            nonce: data.nonce,
          });
          oldActive.transitionTo("redundant");
          registration.active = waiting;
          registration.waiting = null;
          waiting.transitionTo("activated");
        } else {
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
            flushed: true,
            version: data.version,
            nonce: data.nonce,
          });
        }
        transfer[0]?.close();
      },
    );
    const registration: {
      active: MockServiceWorker;
      waiting: MockServiceWorker | null;
    } = { active: oldActive, waiting };
    const test = harness();
    test.subscription.unsubscribe.mockImplementation(() => {
      timeline.push("browser-unsubscribed");
      return Promise.resolve(true);
    });
    test.adapter.suppressDelivery.mockImplementation(() =>
      suppressBrowserPushDelivery(5, 100),
    );
    stubSuppressionBrowser(registration, cacheState.cache);

    await expect(
      clearBrowserPushSubscription(
        () => Promise.resolve({ ok: true, removed: true }),
        test.adapter,
      ),
    ).resolves.toBe("browser-unsubscribed");

    expect(timeline.indexOf("browser-unsubscribed")).toBeLessThan(
      timeline.indexOf("marker-written"),
    );
    expect(waitingMessages.map((message) => messageRecord(message).type)).toEqual(
      [
        "SKITZA_PUSH_SUPPRESSION_CAPABILITY",
        "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT",
        "SKITZA_PUSH_SUPPRESSION_CAPABILITY",
        "SKITZA_PUSH_SUPPRESSION_FLUSH",
      ],
    );
  });

  it("fails closed when a flush ACK returns another boundary nonce", async () => {
    const cacheState = createNonceCache();
    const active = new MockServiceWorker(
      "activated",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        const data = messageRecord(message);
        transfer[0]?.postMessage(
          data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY"
            ? {
                type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
                supported: true,
                flushSupported: true,
                version: ACTIVE_VERSION,
              }
            : {
                type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
                flushed: true,
                version: data.version,
                nonce: OTHER_BOUNDARY_NONCE,
              },
        );
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser({ active, waiting: null }, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(false);

    expect(
      cacheState
        .marker()
        ?.headers.get(PUSH_DELIVERY_BOUNDARY_NONCE_HEADER),
    ).toBe(BOUNDARY_NONCE);
  });

  it("fails closed when another boundary replaces the marker after an exact flush ACK", async () => {
    const cacheState = createNonceCache();
    const active = new MockServiceWorker(
      "activated",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        const data = messageRecord(message);
        if (data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY") {
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
            supported: true,
            flushSupported: true,
            version: ACTIVE_VERSION,
          });
        } else {
          cacheState.replaceMarker(OTHER_BOUNDARY_NONCE);
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
            flushed: true,
            version: data.version,
            nonce: data.nonce,
          });
        }
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser({ active, waiting: null }, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(false);

    expect(
      cacheState
        .marker()
        ?.headers.get(PUSH_DELIVERY_BOUNDARY_NONCE_HEADER),
    ).toBe(OTHER_BOUNDARY_NONCE);
  });

  it("fails closed when the waiting worker activation version changes", async () => {
    const cacheState = createNonceCache();
    const oldActive = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
          version: "2026-07-24-sk116-3",
        });
        transfer[0]?.close();
      },
    );
    const waitingMessages: unknown[] = [];
    const waiting = new MockServiceWorker(
      "installed",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        waitingMessages.push(message);
        const data = messageRecord(message);
        transfer[0]?.postMessage(
          data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY"
            ? {
                type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
                supported: true,
                flushSupported: true,
                version: ACTIVE_VERSION,
              }
            : {
                type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
                activated: true,
                version: "2026-07-24-sk116-replaced",
                nonce: data.nonce,
              },
        );
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser(
      { active: oldActive, waiting },
      cacheState.cache,
    );

    await expect(suppressBrowserPushDelivery(50, 50)).resolves.toBe(false);

    expect(waitingMessages).toHaveLength(2);
    expect(cacheState.cache.put).toHaveBeenCalledOnce();
  });

  it("fails immediately when the exact waiting worker becomes redundant", async () => {
    const cacheState = createNonceCache();
    const oldActive = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
          version: "2026-07-24-sk116-3",
        });
        transfer[0]?.close();
      },
    );
    const replacement = new MockServiceWorker("installed", () => undefined);
    const waitingMessages: unknown[] = [];
    const waiting = new MockServiceWorker(
      "installed",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        waitingMessages.push(message);
        const data = messageRecord(message);
        if (data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY") {
          transfer[0]?.postMessage({
            type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
            supported: true,
            flushSupported: true,
            version: ACTIVE_VERSION,
          });
        } else {
          transfer[0]?.postMessage({
            type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
            activated: true,
            version: data.version,
            nonce: data.nonce,
          });
          registration.waiting = replacement;
          waiting.transitionTo("redundant");
        }
        transfer[0]?.close();
      },
    );
    const registration: {
      active: MockServiceWorker;
      waiting: MockServiceWorker | null;
    } = { active: oldActive, waiting };
    stubSuppressionBrowser(registration, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50, 500)).resolves.toBe(false);

    expect(waitingMessages).toHaveLength(2);
    expect(waiting.state).toBe("redundant");
    expect(registration.active).toBe(oldActive);
  });

  it("fails closed when the exact active worker cannot verify cleanup", async () => {
    const cacheState = createNonceCache();
    const active = new MockServiceWorker(
      "activated",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        const data = messageRecord(message);
        transfer[0]?.postMessage(
          data.type === "SKITZA_PUSH_SUPPRESSION_CAPABILITY"
            ? {
                type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
                supported: true,
                flushSupported: true,
                version: ACTIVE_VERSION,
              }
            : {
                type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
                flushed: false,
                version: data.version,
                nonce: data.nonce,
              },
        );
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser({ active, waiting: null }, cacheState.cache);

    await expect(suppressBrowserPushDelivery(50)).resolves.toBe(false);

    expect(cacheState.cache.put).toHaveBeenCalledOnce();
  });

  it("rejects a capability-none active when the waiting worker cannot flush", async () => {
    const cacheState = createNonceCache();
    const oldActive = new MockServiceWorker(
      "activated",
      (_message: unknown, transfer: readonly MessagePort[] = []) => {
        transfer[0]?.close();
      },
    );
    const waitingMessages: unknown[] = [];
    const waiting = new MockServiceWorker(
      "installed",
      (message: unknown, transfer: readonly MessagePort[] = []) => {
        waitingMessages.push(message);
        transfer[0]?.postMessage({
          type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
          supported: true,
          version: "2026-07-24-sk116-3",
        });
        transfer[0]?.close();
      },
    );
    stubSuppressionBrowser(
      { active: oldActive, waiting },
      cacheState.cache,
    );

    await expect(suppressBrowserPushDelivery(5, 50)).resolves.toBe(false);

    expect(waitingMessages).toHaveLength(1);
    expect(cacheState.cache.put).not.toHaveBeenCalled();
  });
});
