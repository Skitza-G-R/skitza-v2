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
const SW_VERSION = "2026-08-13-sk236-1";
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
  clientPath: string | readonly string[] = "/dashboard",
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
  const clients = clientSafety.map((safe, index) => {
    const path =
      typeof clientPath === "string"
        ? clientPath
        : (clientPath[index] ?? "/dashboard");
    const client = {
      url: path.startsWith("/") ? `${OWN_ORIGIN}${path}` : path,
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

function launchDocumentResponse(
  html: string,
  {
    cacheControl,
    publicMarker = true,
    redirected = false,
    url = `${OWN_ORIGIN}/launch`,
    vary,
  }: {
    cacheControl?: string;
    publicMarker?: boolean;
    redirected?: boolean;
    url?: string;
    vary?: string;
  } = {},
): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
  });
  if (publicMarker) headers.set("x-skitza-public-bootstrap", "1");
  if (cacheControl) headers.set("cache-control", cacheControl);
  if (vary) headers.set("vary", vary);

  const response = new Response(html, { headers });
  Object.defineProperties(response, {
    redirected: { configurable: true, value: redirected },
    type: { configurable: true, value: "basic" },
    url: { configurable: true, value: url },
  });
  return response;
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
    expect(harness.cache.addAll.mock.calls[0]?.[0]).not.toContain("/launch");
    expect(harness.cache.put).not.toHaveBeenCalled();
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.deleteCache).toHaveBeenCalledWith("skitza-shell-v3");
    expect(harness.deleteCache).not.toHaveBeenCalledWith("skitza-push-control-v1");
    expect(harness.deleteCache).not.toHaveBeenCalledWith("unrelated-cache");
  });

  it("takes over after the version reply when every open window is the exact public launch", async () => {
    const harness = createHarness(
      [false, false],
      false,
      ["/launch", "/launch"],
    );
    const channel = new MessageChannel();
    const result = nextPortMessage(channel.port1);
    let versionWork: Promise<unknown> | undefined;

    harness.listener("message")({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [channel.port2],
      waitUntil(work: Promise<unknown>) {
        versionWork = work;
      },
    });
    await expect(result).resolves.toMatchObject({
      type: "SKITZA_VERSION",
      version: SW_VERSION,
    });
    await versionWork;

    expect(harness.skipWaiting).toHaveBeenCalledOnce();
    expect(harness.clientMessages).toEqual([]);
    channel.port1.close();
    channel.port2.close();
  });

  it.each([
    { name: "a protected dashboard", paths: ["/dashboard"] },
    { name: "mixed launch and dashboard windows", paths: ["/launch", "/dashboard"] },
    { name: "a query-bearing launch URL", paths: ["/launch?next=%2Fdashboard"] },
    { name: "no open windows", paths: [] },
    { name: "a malformed client URL", paths: ["not a valid URL"] },
  ])("does not take over after the version reply for $name", async ({ paths }) => {
    const harness = createHarness(
      paths.map(() => false),
      false,
      paths,
    );
    const channel = new MessageChannel();
    const result = nextPortMessage(channel.port1);
    let versionWork: Promise<unknown> | undefined;

    harness.listener("message")({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [channel.port2],
      waitUntil(work: Promise<unknown>) {
        versionWork = work;
      },
    });
    await expect(result).resolves.toMatchObject({
      type: "SKITZA_VERSION",
      version: SW_VERSION,
    });
    await versionWork;

    expect(harness.skipWaiting).not.toHaveBeenCalled();
    channel.port1.close();
    channel.port2.close();
  });

  it("caches validated public launch HTML before extracting only hashed Next static assets", async () => {
    const harness = createHarness();
    const launchHtml = [
      "<!doctype html>",
      '<link rel="stylesheet" href="/_next/static/css/app-a1b2c3.css">',
      '<script src="/_next/static/chunks/app/launch/page-d4e5f6.js"></script>',
      '<script src="/_next/static/chunks/app/launch/page-d4e5f6.js"></script>',
      '<a href="/dashboard">Private dashboard</a>',
      '<script src="/api/private-bootstrap"></script>',
      '<script src="https://other.example/_next/static/chunks/foreign.js"></script>',
      '<script src="/_next/static/../../api/private-traversal"></script>',
      '<script src="/_next/static/%2e%2e/%2e%2e/api/private-encoded"></script>',
    ].join("");
    harness.fetch.mockResolvedValueOnce(launchDocumentResponse(launchHtml));
    let installWork: Promise<unknown> | undefined;

    harness.listener("install")({
      waitUntil(work: Promise<unknown>) {
        installWork = work;
      },
    });
    await installWork;

    expect(harness.fetch).toHaveBeenCalledWith(`${OWN_ORIGIN}/launch`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    expect(harness.cache.put).toHaveBeenCalledWith(
      "/launch",
      expect.any(Response),
    );
    expect(harness.cache.addAll).toHaveBeenCalledTimes(2);
    expect(harness.cache.addAll).toHaveBeenNthCalledWith(2, [
      "/_next/static/css/app-a1b2c3.css",
      "/_next/static/chunks/app/launch/page-d4e5f6.js",
    ]);
    expect(harness.cache.addAll.mock.invocationCallOrder[1]).toBeLessThan(
      harness.cache.put.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("does not commit launch HTML when a required static asset fails", async () => {
    const harness = createHarness();
    harness.fetch.mockResolvedValueOnce(
      launchDocumentResponse(
        '<script src="/_next/static/chunks/app/launch/page-failed.js"></script>',
      ),
    );
    harness.cache.addAll
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError("asset offline"));
    let installWork: Promise<unknown> | undefined;

    harness.listener("install")({
      waitUntil(work: Promise<unknown>) {
        installWork = work;
      },
    });
    await installWork;

    expect(harness.cache.put).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unmarked response",
      response: launchDocumentResponse(
        '<script src="/_next/static/chunks/unmarked.js"></script>',
        { publicMarker: false },
      ),
    },
    {
      name: "private cache control",
      response: launchDocumentResponse(
        '<script src="/_next/static/chunks/private.js"></script>',
        { cacheControl: "private, max-age=300" },
      ),
    },
    {
      name: "cookie-varying response",
      response: launchDocumentResponse(
        '<script src="/_next/static/chunks/vary.js"></script>',
        { vary: "RSC, Cookie" },
      ),
    },
    {
      name: "redirected response",
      response: launchDocumentResponse(
        '<script src="/_next/static/chunks/redirected.js"></script>',
        { redirected: true },
      ),
    },
    {
      name: "cross-origin final response",
      response: launchDocumentResponse(
        '<script src="/_next/static/chunks/cross-origin.js"></script>',
        { url: "https://accounts.example/launch" },
      ),
    },
  ])("does not cache $name launch HTML or its assets", async ({ response }) => {
    const harness = createHarness();
    harness.fetch.mockResolvedValueOnce(response);
    let installWork: Promise<unknown> | undefined;

    harness.listener("install")({
      waitUntil(work: Promise<unknown>) {
        installWork = work;
      },
    });
    await installWork;

    expect(harness.cache.put).not.toHaveBeenCalled();
    expect(harness.cache.addAll).toHaveBeenCalledTimes(1);
    expect(harness.cache.addAll.mock.calls[0]?.[0]).not.toContain("/launch");
  });

  it("uses the same public-only validation on a launch navigation cache miss", async () => {
    const harness = createHarness();
    const launch = launchDocumentResponse(
      '<main>Opening Skitza</main><script src="/_next/static/chunks/app/launch/page-runtime.js"></script>',
    );
    harness.fetch.mockResolvedValueOnce(launch);
    let responseWork: Promise<Response> | undefined;

    harness.listener("fetch")({
      request: navigationRequest("/launch"),
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    await expect(responseWork).resolves.toBe(launch);
    expect(harness.fetch).toHaveBeenCalledWith(`${OWN_ORIGIN}/launch`, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    expect(harness.cache.put).toHaveBeenCalledWith(
      "/launch",
      expect.any(Response),
    );
  });

  it("serves the cached public launch document offline without touching the network", async () => {
    const harness = createHarness();
    const cachedLaunch = new Response("<main>Opening Skitza</main>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    harness.cache.match.mockImplementation((input: unknown) => {
      if (
        typeof input === "object" &&
        input !== null &&
        "url" in input &&
        input.url === `${OWN_ORIGIN}/launch`
      ) {
        return Promise.resolve(cachedLaunch);
      }
      return Promise.resolve(undefined);
    });
    let responseWork: Promise<Response> | undefined;

    harness.listener("fetch")({
      request: navigationRequest("/launch"),
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    await expect(responseWork).resolves.toBe(cachedLaunch);
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.cache.put).not.toHaveBeenCalled();
  });

  it("returns the offline boundary instead of a blank page when launch was not cached", async () => {
    const harness = createHarness();
    let responseWork: Promise<Response> | undefined;

    harness.listener("fetch")({
      request: navigationRequest("/launch"),
      respondWith(work: Promise<Response>) {
        responseWork = work;
      },
    });

    const response = await responseWork;
    expect(await response?.text()).toBe("<h1>Offline</h1>");
    expect(harness.cache.put).not.toHaveBeenCalled();
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
    let versionWork: Promise<unknown> | undefined;
    message({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [versionChannel.port2],
      waitUntil(work: Promise<unknown>) {
        versionWork = work;
      },
    });
    const versionData = (await versionResult) as {
      version: string;
    };
    await versionWork;
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
    let versionWork: Promise<unknown> | undefined;
    message({
      data: { type: "SKITZA_GET_VERSION" },
      ports: [versionChannel.port2],
      waitUntil(work: Promise<unknown>) {
        versionWork = work;
      },
    });
    const versionData = (await versionResult) as {
      version: string;
    };
    await versionWork;
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
