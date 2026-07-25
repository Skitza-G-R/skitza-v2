import { readFileSync } from "node:fs";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ServiceWorkerListener = (event: unknown) => void;
type CacheMatch = ReturnType<
  typeof vi.fn<(input: unknown) => Promise<Response | undefined>>
>;
type DisplayedNotification = Readonly<{ tag: string; close(): void }>;
type GetNotifications = ReturnType<
  typeof vi.fn<() => Promise<DisplayedNotification[]>>
>;
type ShowNotification = ReturnType<
  typeof vi.fn<(title: string, options: unknown) => Promise<void>>
>;

type Harness = Readonly<{
  listener: (type: string) => ServiceWorkerListener;
  cache: {
    addAll: ReturnType<typeof vi.fn>;
    match: CacheMatch;
    put: ReturnType<typeof vi.fn>;
  };
  fetch: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
  deleteCache: ReturnType<typeof vi.fn>;
  showNotification: ShowNotification;
  getNotifications: GetNotifications;
  openWindow: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  clientMessages: unknown[];
}>;

const OWN_ORIGIN = "https://skitza.app";
const SW_VERSION = "2026-07-25-sk118-1";
const BOUNDARY_NONCE = "11111111-2222-4333-8444-555555555555";
const OTHER_BOUNDARY_NONCE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOUNDARY_NONCE_HEADER = "x-skitza-push-boundary-nonce";
const policySource = readFileSync(
  new URL("../../../../public/pwa/cache-policy.js", import.meta.url),
  "utf8",
);
const pushPolicySource = readFileSync(
  new URL("../../../../public/pwa/push-policy.js", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../../../../public/sw.js", import.meta.url),
  "utf8",
);

function nextPortMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.once("message", resolve);
  });
}

function createHarness(
  clientSafety: readonly boolean[] = [true],
  pushSuppressed = false,
  clientPath = "/dashboard",
): Harness {
  const listeners = new Map<string, ServiceWorkerListener[]>();
  const offlineResponse = new Response("<h1>Offline</h1>", {
    headers: { "content-type": "text/html" },
  });
  const cache = {
    addAll: vi.fn(() => Promise.resolve(undefined)),
    match: vi.fn((input: unknown) =>
      Promise.resolve(
        input === "/offline.html"
          ? offlineResponse
          : input === "/pwa/push-delivery-suppressed" && pushSuppressed
            ? new Response(null, { status: 204 })
            : undefined,
      ),
    ),
    put: vi.fn(() => Promise.resolve(undefined)),
  };
  const deleteCache = vi.fn(() => Promise.resolve(true));
  const caches = {
    open: vi.fn(() => Promise.resolve(cache)),
    keys: vi.fn(() =>
      Promise.resolve([
        "skitza-shell-v3",
        "skitza-push-control-v1",
        "unrelated-cache",
      ]),
    ),
    delete: deleteCache,
  };
  const fetchMock = vi.fn(() =>
    Promise.reject<Response>(new TypeError("offline")),
  );
  const skipWaiting = vi.fn(() => Promise.resolve(undefined));
  const showNotification = vi.fn<
    (title: string, options: unknown) => Promise<void>
  >(() => Promise.resolve(undefined));
  const getNotifications = vi.fn<() => Promise<DisplayedNotification[]>>(() =>
    Promise.resolve([]),
  );
  const openWindow = vi.fn(() => Promise.resolve(undefined));
  const navigate = vi.fn();
  const focus = vi.fn(() => Promise.resolve(undefined));
  const clientMessages: unknown[] = [];
  const clients = clientSafety.map((safe) => {
    const client = {
      url: `${OWN_ORIGIN}${clientPath}`,
      postMessage: (message: unknown, transfer: readonly MessagePort[]) => {
        clientMessages.push(message);
        const reply = transfer[0];
        reply?.postMessage({ safe });
        reply?.close();
      },
      navigate,
      focus,
    };
    navigate.mockImplementation(() => Promise.resolve(client));
    return client;
  });
  const scope: Record<string, unknown> = {
    location: { origin: OWN_ORIGIN },
    registration: { showNotification, getNotifications },
    clients: {
      claim: vi.fn(() => Promise.resolve(undefined)),
      matchAll: vi.fn(() => Promise.resolve(clients)),
      openWindow,
    },
    skipWaiting,
    addEventListener: (type: string, listener: ServiceWorkerListener) => {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
  };
  const sandbox = {
    self: scope,
    caches,
    fetch: fetchMock,
    Response,
    URL,
    MessageChannel,
    setTimeout,
    clearTimeout,
    importScripts: vi.fn(),
  };

  runInNewContext(policySource, sandbox);
  runInNewContext(pushPolicySource, sandbox);
  runInNewContext(workerSource, sandbox);

  return {
    listener(type: string) {
      const listener = listeners.get(type)?.[0];
      if (!listener) throw new Error(`missing ${type} listener`);
      return listener;
    },
    cache,
    fetch: fetchMock,
    skipWaiting,
    deleteCache,
    showNotification,
    getNotifications,
    openWindow,
    navigate,
    focus,
    clientMessages,
  };
}

function boundaryMarker(nonce: string): Response {
  return new Response(null, {
    status: 204,
    headers: { [BOUNDARY_NONCE_HEADER]: nonce },
  });
}

function navigationRequest(path: string): Readonly<{
  method: "GET";
  mode: "navigate";
  destination: "document";
  url: string;
  headers: Headers;
}> {
  return {
    method: "GET",
    mode: "navigate",
    destination: "document",
    url: new URL(path, OWN_ORIGIN).toString(),
    headers: new Headers({ Accept: "text/html" }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("service worker offline and update protocol", () => {
  it("pre-caches the offline boundary without taking over during install", async () => {
    const harness = createHarness();
    let installWork: Promise<unknown> | undefined;

    harness.listener("install")({
      waitUntil(work: Promise<unknown>) {
        installWork = work;
      },
    });
    await installWork;

    expect(harness.cache.addAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        "/offline.html",
        "/pwa/offline-context.js",
        "/manifest.webmanifest",
        "/icons/apple-touch-icon-180.png",
      ]),
    );
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.deleteCache).toHaveBeenCalledWith("skitza-shell-v3");
    expect(harness.deleteCache).not.toHaveBeenCalledWith("skitza-push-control-v1");
    expect(harness.deleteCache).not.toHaveBeenCalledWith("unrelated-cache");
  });

  it("returns the public offline boundary for failed navigation without caching HTML", async () => {
    const harness = createHarness();
    let responseWork: Promise<Response> | undefined;

    harness.listener("fetch")({
      request: navigationRequest("/dashboard/clients"),
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    const response = await responseWork;
    expect(await response?.text()).toBe("<h1>Offline</h1>");
    expect(harness.cache.put).not.toHaveBeenCalled();
  });

  it("passes authenticated navigation through the network and never caches its response", async () => {
    const harness = createHarness();
    const privateResponse = new Response("<h1>Private dashboard</h1>");
    harness.fetch.mockResolvedValueOnce(privateResponse);
    let responseWork: Promise<Response> | undefined;

    harness.listener("fetch")({
      request: navigationRequest("/dashboard"),
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    expect(await responseWork).toBe(privateResponse);
    expect(harness.cache.put).not.toHaveBeenCalled();
  });

  it("proves to the client that the active worker enforces push suppression", async () => {
    const harness = createHarness();
    const channel = new MessageChannel();
    const result = nextPortMessage(channel.port1);

    harness.listener("message")({
      data: { type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY" },
      ports: [channel.port2],
    });

    await expect(result).resolves.toMatchObject({
      type: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
      supported: true,
      flushSupported: true,
    });
    channel.port1.close();
    channel.port2.close();
  });

  it("refuses activation when any open client reports unsafe work", async () => {
    const harness = createHarness([true, false]);
    const message = harness.listener("message");
    const versionChannel = new MessageChannel();
    const versionResult = nextPortMessage(versionChannel.port1);
    message({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [versionChannel.port2],
    });
    const versionData = (await versionResult) as {
      version: string;
    };
    versionChannel.port1.close();
    versionChannel.port2.close();

    const activationChannel = new MessageChannel();
    const activationResult = nextPortMessage(activationChannel.port1);
    let activationWork: Promise<unknown> | undefined;
    message({
      data: {
        type: "SKITZA_ACTIVATE_ON_SAFE_REOPEN",
        safeReopen: true,
        version: versionData.version,
      },
      ports: [activationChannel.port2],
      waitUntil(work: Promise<unknown>) {
        activationWork = work;
      },
    });
    await activationWork;

    await expect(activationResult).resolves.toMatchObject({
      activated: false,
    });
    activationChannel.port1.close();
    activationChannel.port2.close();
    expect(harness.skipWaiting).not.toHaveBeenCalled();
  });

  it("activates only after every open client confirms a safe reopen", async () => {
    const harness = createHarness([true, true]);
    const message = harness.listener("message");
    const versionChannel = new MessageChannel();
    const versionResult = nextPortMessage(versionChannel.port1);
    message({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [versionChannel.port2],
    });
    const versionData = (await versionResult) as {
      version: string;
    };
    versionChannel.port1.close();
    versionChannel.port2.close();

    const activationChannel = new MessageChannel();
    const activationResult = nextPortMessage(activationChannel.port1);
    let activationWork: Promise<unknown> | undefined;
    message({
      data: {
        type: "SKITZA_ACTIVATE_ON_SAFE_REOPEN",
        safeReopen: true,
        version: versionData.version,
      },
      ports: [activationChannel.port2],
      waitUntil(work: Promise<unknown>) {
        activationWork = work;
      },
    });
    await activationWork;

    await expect(activationResult).resolves.toMatchObject({
      activated: true,
    });
    activationChannel.port1.close();
    activationChannel.port2.close();
    expect(harness.skipWaiting).toHaveBeenCalledOnce();
    expect(harness.clientMessages).toEqual([
      expect.objectContaining({
        type: "SKITZA_CLIENT_SAFETY_QUERY",
      }),
      expect.objectContaining({
        type: "SKITZA_CLIENT_SAFETY_QUERY",
      }),
    ]);
    expect(harness.clientMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountExitStarted: true }),
      ]),
    );
  });

  it("activates a nonce-bound account exit on a protected route without client ACKs", async () => {
    const harness = createHarness(
      [false, false],
      false,
      "/dashboard/calendar/booking/1",
    );
    harness.cache.match.mockImplementation((input: unknown) =>
      Promise.resolve(
        input === "/pwa/push-delivery-suppressed"
          ? boundaryMarker(BOUNDARY_NONCE)
          : undefined,
      ),
    );
    const message = harness.listener("message");
    const activationChannel = new MessageChannel();
    const activationResult = nextPortMessage(activationChannel.port1);
    let activationWork: Promise<unknown> | undefined;
    message({
      data: {
        type: "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT",
        accountExitStarted: true,
        version: SW_VERSION,
        nonce: BOUNDARY_NONCE,
      },
      ports: [activationChannel.port2],
      waitUntil(work: Promise<unknown>) {
        activationWork = work;
      },
    });
    await activationWork;

    await expect(activationResult).resolves.toMatchObject({
      type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
      activated: true,
      version: SW_VERSION,
      nonce: BOUNDARY_NONCE,
    });
    expect(harness.clientMessages).toEqual([]);
    expect(harness.skipWaiting).toHaveBeenCalledOnce();
    activationChannel.port1.close();
    activationChannel.port2.close();
  });

  it("refuses account-exit takeover when the marker nonce does not match", async () => {
    const harness = createHarness([false]);
    harness.cache.match.mockImplementation((input: unknown) =>
      Promise.resolve(
        input === "/pwa/push-delivery-suppressed"
          ? boundaryMarker(OTHER_BOUNDARY_NONCE)
          : undefined,
      ),
    );
    const activationChannel = new MessageChannel();
    const activationResult = nextPortMessage(activationChannel.port1);
    let activationWork: Promise<unknown> | undefined;
    harness.listener("message")({
      data: {
        type: "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT",
        accountExitStarted: true,
        version: SW_VERSION,
        nonce: BOUNDARY_NONCE,
      },
      ports: [activationChannel.port2],
      waitUntil(work: Promise<unknown>) {
        activationWork = work;
      },
    });
    await activationWork;

    await expect(activationResult).resolves.toMatchObject({
      type: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
      activated: false,
      version: SW_VERSION,
      nonce: BOUNDARY_NONCE,
    });
    expect(harness.clientMessages).toEqual([]);
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    activationChannel.port1.close();
    activationChannel.port2.close();
  });
});

describe("service worker push and exact-item navigation", () => {
  const itemId = "00000000-0000-4000-8000-000000000112";
  const requestId = "00000000-0000-4000-8000-000000000113";

  it("shows only a validated payload and does not request vibration", async () => {
    const harness = createHarness();
    let pushWork: Promise<unknown> | undefined;
    harness.listener("push")({
      data: {
        json: () => ({
          version: 1,
          category: "comment",
          title: "New comment",
          body: "Open Skitza to review the feedback.",
          url: `/dashboard/music/${itemId}`,
        }),
      },
      waitUntil(work: Promise<unknown>) {
        pushWork = work;
      },
    });
    await pushWork;

    expect(harness.showNotification).toHaveBeenCalledWith(
      "New comment",
      expect.objectContaining({
        body: "Open Skitza to review the feedback.",
        data: { url: `/dashboard/music/${itemId}` },
        tag: "skitza-comment",
      }),
    );
    expect(harness.showNotification.mock.calls[0]?.[1]).not.toHaveProperty("vibrate");
  });

  it("suppresses a valid push while the durable account-switch boundary is active", async () => {
    const harness = createHarness([true], true);
    let pushWork: Promise<unknown> | undefined;
    harness.listener("push")({
      data: {
        json: () => ({
          version: 1,
          category: "comment",
          title: "New comment",
          body: "Open Skitza to review the feedback.",
          url: `/dashboard/music/${itemId}`,
        }),
      },
      waitUntil(work: Promise<unknown>) {
        pushWork = work;
      },
    });
    await pushWork;

    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  it("re-checks suppression before display when a boundary lands during push work", async () => {
    const harness = createHarness();
    let suppressionReads = 0;
    let finishFinalCheck:
      | ((response: Response | undefined) => void)
      | undefined;
    harness.cache.match.mockImplementation((input: unknown) => {
      if (input !== "/pwa/push-delivery-suppressed") {
        return Promise.resolve(undefined);
      }
      suppressionReads += 1;
      if (suppressionReads === 1) return Promise.resolve(undefined);
      return new Promise<Response | undefined>((resolve) => {
        finishFinalCheck = resolve;
      });
    });
    let pushWork: Promise<unknown> | undefined;
    harness.listener("push")({
      data: {
        json: () => ({
          version: 1,
          category: "comment",
          title: "New comment",
          body: "Open Skitza to review the feedback.",
          url: `/dashboard/music/${itemId}`,
        }),
      },
      waitUntil(work: Promise<unknown>) {
        pushWork = work;
      },
    });

    await vi.waitFor(() => {
      expect(suppressionReads).toBe(2);
    });
    finishFinalCheck?.(new Response(null, { status: 204 }));
    await pushWork;

    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  it("drains a pending display before acknowledging a suppression flush", async () => {
    const harness = createHarness();
    let suppressed = false;
    harness.cache.match.mockImplementation((input: unknown) =>
      Promise.resolve(
        input === "/pwa/push-delivery-suppressed" && suppressed
          ? boundaryMarker(BOUNDARY_NONCE)
          : undefined,
      ),
    );
    let displayed: DisplayedNotification[] = [];
    const close = vi.fn(() => {
      displayed = [];
    });
    const notification = { tag: "skitza-comment", close };
    let finishDisplay: (() => void) | undefined;
    harness.showNotification.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisplay = () => {
            displayed = [notification];
            resolve();
          };
        }),
    );
    harness.getNotifications.mockImplementation(() =>
      Promise.resolve([...displayed]),
    );

    let pushWork: Promise<unknown> | undefined;
    harness.listener("push")({
      data: {
        json: () => ({
          version: 1,
          category: "comment",
          title: "New comment",
          body: "Open Skitza to review the feedback.",
          url: `/dashboard/music/${itemId}`,
        }),
      },
      waitUntil(work: Promise<unknown>) {
        pushWork = work;
      },
    });
    await vi.waitFor(() => {
      expect(harness.showNotification).toHaveBeenCalledOnce();
    });

    suppressed = true;
    await expect(harness.getNotifications()).resolves.toEqual([]);
    const channel = new MessageChannel();
    let flushAcknowledged = false;
    const flushResult = nextPortMessage(channel.port1).then((result) => {
      flushAcknowledged = true;
      return result;
    });
    let flushWork: Promise<unknown> | undefined;
    harness.listener("message")({
      data: {
        type: "SKITZA_PUSH_SUPPRESSION_FLUSH",
        version: SW_VERSION,
        nonce: BOUNDARY_NONCE,
      },
      ports: [channel.port2],
      waitUntil(work: Promise<unknown>) {
        flushWork = work;
      },
    });
    await Promise.resolve();
    expect(flushAcknowledged).toBe(false);

    finishDisplay?.();
    await pushWork;
    await flushWork;

    await expect(flushResult).resolves.toMatchObject({
      type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
      flushed: true,
      version: SW_VERSION,
      nonce: BOUNDARY_NONCE,
    });
    expect(close).toHaveBeenCalledOnce();
    await expect(harness.getNotifications()).resolves.toEqual([]);
    channel.port1.close();
    channel.port2.close();
  });

  it("fails a suppression flush when a Skitza notification remains displayed", async () => {
    const harness = createHarness();
    harness.cache.match.mockImplementation((input: unknown) =>
      Promise.resolve(
        input === "/pwa/push-delivery-suppressed"
          ? boundaryMarker(BOUNDARY_NONCE)
          : undefined,
      ),
    );
    const close = vi.fn();
    harness.getNotifications.mockResolvedValue([
      { tag: "skitza-payment", close },
    ]);
    const channel = new MessageChannel();
    const flushResult = nextPortMessage(channel.port1);
    let flushWork: Promise<unknown> | undefined;

    harness.listener("message")({
      data: {
        type: "SKITZA_PUSH_SUPPRESSION_FLUSH",
        version: SW_VERSION,
        nonce: BOUNDARY_NONCE,
      },
      ports: [channel.port2],
      waitUntil(work: Promise<unknown>) {
        flushWork = work;
      },
    });
    await flushWork;

    await expect(flushResult).resolves.toMatchObject({
      type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
      flushed: false,
      version: SW_VERSION,
      nonce: BOUNDARY_NONCE,
    });
    expect(close).toHaveBeenCalledOnce();
    channel.port1.close();
    channel.port2.close();
  });

  it("fails a flush when another tab replaces the marker nonce during cleanup", async () => {
    const harness = createHarness();
    let currentNonce = BOUNDARY_NONCE;
    harness.cache.match.mockImplementation((input: unknown) =>
      Promise.resolve(
        input === "/pwa/push-delivery-suppressed"
          ? boundaryMarker(currentNonce)
          : undefined,
      ),
    );
    let finishNotificationLookup:
      | ((notifications: DisplayedNotification[]) => void)
      | undefined;
    harness.getNotifications
      .mockImplementationOnce(
        () =>
          new Promise<DisplayedNotification[]>((resolve) => {
            finishNotificationLookup = resolve;
          }),
      )
      .mockResolvedValue([]);
    const channel = new MessageChannel();
    const flushResult = nextPortMessage(channel.port1);
    let flushWork: Promise<unknown> | undefined;

    harness.listener("message")({
      data: {
        type: "SKITZA_PUSH_SUPPRESSION_FLUSH",
        version: SW_VERSION,
        nonce: BOUNDARY_NONCE,
      },
      ports: [channel.port2],
      waitUntil(work: Promise<unknown>) {
        flushWork = work;
      },
    });
    await vi.waitFor(() => {
      expect(harness.getNotifications).toHaveBeenCalledOnce();
    });

    currentNonce = OTHER_BOUNDARY_NONCE;
    finishNotificationLookup?.([]);
    await flushWork;

    await expect(flushResult).resolves.toMatchObject({
      type: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
      flushed: false,
      version: SW_VERSION,
      nonce: BOUNDARY_NONCE,
    });
    expect(harness.getNotifications).toHaveBeenCalledTimes(2);
    channel.port1.close();
    channel.port2.close();
  });

  it("drops malformed, invented-category, and external push data", () => {
    const harness = createHarness();
    for (const payload of [
      {
        version: 1,
        category: "weekly",
        title: "Fake",
        body: "Fake",
        url: `/dashboard/music/${itemId}`,
      },
      {
        version: 1,
        category: "comment",
        title: "Unsafe",
        body: "Unsafe",
        url: "https://evil.example/item",
      },
      null,
    ]) {
      harness.listener("push")({
        data: { json: () => payload },
        waitUntil: vi.fn(),
      });
    }
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  it("navigates and focuses an open Skitza client only for an exact route", async () => {
    const harness = createHarness();
    const close = vi.fn();
    let clickWork: Promise<unknown> | undefined;
    harness.listener("notificationclick")({
      notification: {
        data: {
          url: `/artist/purchase/${itemId}/pay?req=${requestId}`,
        },
        close,
      },
      waitUntil(work: Promise<unknown>) {
        clickWork = work;
      },
    });
    await clickWork;

    expect(close).toHaveBeenCalledOnce();
    expect(harness.navigate).toHaveBeenCalledWith(
      `/artist/purchase/${itemId}/pay?req=${requestId}`,
    );
    expect(harness.focus).toHaveBeenCalledOnce();
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  it("closes but never navigates an unsafe notification", () => {
    const harness = createHarness();
    const close = vi.fn();
    const waitUntil = vi.fn();
    harness.listener("notificationclick")({
      notification: {
        data: { url: "//evil.example/dashboard" },
        close,
      },
      waitUntil,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.openWindow).not.toHaveBeenCalled();
  });
});
