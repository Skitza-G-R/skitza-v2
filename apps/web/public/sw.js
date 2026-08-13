/* Skitza installable-web-app service worker.
 *
 * This worker deliberately has a very small cache surface:
 * hash-versioned Next static assets plus a short allowlist of public PWA
 * resources. Authenticated HTML/RSC/API data, Clerk traffic, action routes,
 * signed URLs, uploads, and audio are always network-only.
 *
 * A replacement worker never calls skipWaiting during install. Normal updates
 * require a safe reopen after this exact version was observed before boot. A
 * waiting worker may also take over when its version probe proves every open
 * window is still the exact public /launch bootstrap.
 * An already-started account exit may request a bounded handoff only after the
 * durable push fence is nonce-bound. That takeover does not reload clients,
 * and service-worker activation waits for the old worker's pending events.
 */

importScripts("/pwa/cache-policy.js");
importScripts("/pwa/push-policy.js");

const SW_VERSION = "2026-08-13-sk237-1";
const CACHE_PREFIX = "skitza-native-";
const CACHE_NAME = `${CACHE_PREFIX}${SW_VERSION}`;
const OBSOLETE_CACHE_PREFIX = "skitza-shell-";
const OFFLINE_URL = "/offline.html";
const PUBLIC_LAUNCH_HEADER = "x-skitza-public-bootstrap";
const PUSH_DELIVERY_CONTROL_CACHE = "skitza-push-control-v1";
const PUSH_DELIVERY_SUPPRESSED_URL = "/pwa/push-delivery-suppressed";
const PUSH_DELIVERY_BOUNDARY_NONCE_HEADER =
  "x-skitza-push-boundary-nonce";
const SKITZA_NOTIFICATION_TAG_PREFIX = "skitza-";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/pwa/offline-context.js",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon-180.png",
  "/icons/skitza-192.png",
  "/icons/skitza-512.png",
  "/icons/skitza-maskable-192.png",
  "/icons/skitza-maskable-512.png",
];
const MESSAGE = {
  activateForAccountExit: "SKITZA_ACTIVATE_FOR_ACCOUNT_EXIT",
  activateOnSafeReopen: "SKITZA_ACTIVATE_ON_SAFE_REOPEN",
  accountExitActivationResult: "SKITZA_ACCOUNT_EXIT_ACTIVATION_RESULT",
  activationResult: "SKITZA_ACTIVATION_RESULT",
  clientSafetyQuery: "SKITZA_CLIENT_SAFETY_QUERY",
  getVersion: "SKITZA_GET_VERSION",
  pushSuppressionCapability: "SKITZA_PUSH_SUPPRESSION_CAPABILITY",
  pushSuppressionCapabilityResult: "SKITZA_PUSH_SUPPRESSION_CAPABILITY_RESULT",
  pushSuppressionFlush: "SKITZA_PUSH_SUPPRESSION_FLUSH",
  pushSuppressionFlushResult: "SKITZA_PUSH_SUPPRESSION_FLUSH_RESULT",
  version: "SKITZA_VERSION",
};
const CLIENT_SAFETY_TIMEOUT_MS = 1500;

const policy = self.SkitzaCachePolicy;
const pushPolicy = self.SkitzaPushPolicy;
let pushDisplayWork = Promise.resolve();

function isCacheableResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;

  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  const vary = (response.headers.get("vary") || "").toLowerCase();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const disposition = (
    response.headers.get("content-disposition") || ""
  ).toLowerCase();

  return (
    !/(?:^|,|\s)(?:private|no-store)(?:,|\s|$)/.test(cacheControl) &&
    vary !== "*" &&
    !vary.includes("authorization") &&
    !vary.includes("cookie") &&
    !contentType.startsWith("audio/") &&
    !contentType.startsWith("video/") &&
    !disposition.includes("attachment")
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const requestUrl = new URL(request.url);
  const isLaunchDocument =
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname === "/launch" &&
    requestUrl.search === "";
  let response;
  try {
    response = isLaunchDocument
      ? await fetchPublicLaunchDocument()
      : await fetch(request);
  } catch (error) {
    if (isLaunchDocument) return offlineBoundaryResponse();
    throw error;
  }
  if (isLaunchDocument) {
    try {
      await cacheLaunchDocumentAndStaticAssets(
        cache,
        response,
        new URL("/launch", self.location.origin),
      );
    } catch {
      // The online public document can still render. It becomes durable only
      // after every required static asset is safely available offline.
    }
  } else if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

function isCacheableLaunchDocument(response, launchUrl) {
  if (
    !isCacheableResponse(response) ||
    response.redirected ||
    response.headers.get(PUBLIC_LAUNCH_HEADER) !== "1" ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("text/html")
  ) {
    return false;
  }

  try {
    const responseUrl = new URL(response.url);
    return (
      responseUrl.origin === self.location.origin &&
      responseUrl.href === launchUrl.href
    );
  } catch {
    return false;
  }
}

function fetchPublicLaunchDocument() {
  return fetch(new URL("/launch", self.location.origin).href, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
  });
}

async function cacheLaunchDocumentAndStaticAssets(cache, launch, launchUrl) {
  if (!isCacheableLaunchDocument(launch, launchUrl)) return false;

  const html = await launch.clone().text();
  const assets = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = attributePattern.exec(html)) !== null) {
    const candidate = match[1];
    if (typeof candidate !== "string") continue;

    const decodedCandidate = candidate.replace(/&amp;/g, "&");
    if (!decodedCandidate.startsWith("/_next/static/")) continue;

    try {
      const assetUrl = new URL(decodedCandidate, self.location.origin);
      if (
        assetUrl.origin === self.location.origin &&
        assetUrl.pathname.startsWith("/_next/static/")
      ) {
        assets.add(`${assetUrl.pathname}${assetUrl.search}`);
      }
    } catch {
      // Malformed launch markup never broadens the static cache allowlist.
    }
  }

  if (assets.size === 0) return false;
  await cache.addAll(Array.from(assets));
  await cache.put("/launch", launch.clone());
  return true;
}

async function precacheLaunchDocumentAndStaticAssets(cache) {
  try {
    const launchUrl = new URL("/launch", self.location.origin);
    const launch = await fetchPublicLaunchDocument();
    await cacheLaunchDocumentAndStaticAssets(cache, launch, launchUrl);
  } catch {
    // A launch response that cannot be completely verified and cached stays
    // network-only. Public chunks still use the normal cache-first path.
  }
}

async function offlineBoundaryResponse() {
  const cache = await caches.open(CACHE_NAME);
  const offline = await cache.match(OFFLINE_URL);
  if (offline) return offline;

  return new Response("Skitza is offline. Reconnect and try again.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function networkWithOfflineBoundary(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineBoundaryResponse();
  }
}

async function browserPushDeliveryIsSuppressed() {
  try {
    const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
    return Boolean(await cache.match(PUSH_DELIVERY_SUPPRESSED_URL));
  } catch {
    // A broken local privacy control fails closed for notification display.
    return true;
  }
}

function isPushBoundaryNonce(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9-]+$/.test(value)
  );
}

async function browserPushDeliveryFenceMatches(nonce) {
  try {
    const cache = await caches.open(PUSH_DELIVERY_CONTROL_CACHE);
    const marker = await cache.match(PUSH_DELIVERY_SUPPRESSED_URL);
    return Boolean(
      marker &&
      marker.headers.get(PUSH_DELIVERY_BOUNDARY_NONCE_HEADER) === nonce
    );
  } catch {
    return false;
  }
}

async function closeDisplayedSkitzaNotifications() {
  if (typeof self.registration.getNotifications !== "function") return false;

  try {
    const displayed = await self.registration.getNotifications();
    for (const notification of displayed) {
      if (
        typeof notification.tag === "string" &&
        notification.tag.startsWith(SKITZA_NOTIFICATION_TAG_PREFIX)
      ) {
        notification.close();
      }
    }

    const remaining = await self.registration.getNotifications();
    return !remaining.some(
      (notification) =>
        typeof notification.tag === "string" &&
        notification.tag.startsWith(SKITZA_NOTIFICATION_TAG_PREFIX),
    );
  } catch {
    return false;
  }
}

function enqueuePushDisplay(work) {
  const display = pushDisplayWork.then(work);
  pushDisplayWork = display.catch(() => undefined);
  return display;
}

function queryClientSafety(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, CLIENT_SAFETY_TIMEOUT_MS);

    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data && event.data.safe === true);
    };

    try {
      client.postMessage(
        {
          type: MESSAGE.clientSafetyQuery,
          version: SW_VERSION,
        },
        [channel.port2],
      );
    } catch {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(false);
    }
  });
}

async function allOpenClientsAreSafe() {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (clients.length === 0) return false;

  const safety = await Promise.all(clients.map(queryClientSafety));
  return safety.every(Boolean);
}

async function allOpenClientsAreExactPublicLaunch() {
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    if (clients.length === 0) return false;

    const launchUrl = new URL("/launch", self.location.origin).href;
    return clients.every((client) => {
      try {
        return new URL(client.url).href === launchUrl;
      } catch {
        return false;
      }
    });
  } catch {
    // Client enumeration failures preserve the normal waiting-worker path.
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await precacheLaunchDocumentAndStaticAssets(cache);

      // The replaced worker cached authenticated shell HTML. Remove that
      // obsolete cache as soon as the privacy-safe worker is installed,
      // without forcing the new worker to take over an active session.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(OBSOLETE_CACHE_PREFIX))
          .map((key) => caches.delete(key)),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key !== CACHE_NAME &&
              (key.startsWith(CACHE_PREFIX) ||
                key.startsWith(OBSOLETE_CACHE_PREFIX)),
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const decision = policy.classifyRequest(request, self.location.origin);

  if (decision.action === "cache") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (
    request.method === "GET" &&
    request.mode === "navigate" &&
    new URL(request.url).origin === self.location.origin
  ) {
    event.respondWith(networkWithOfflineBoundary(request));
  }
});

self.addEventListener("push", (event) => {
  let raw;
  try {
    raw = event.data ? event.data.json() : null;
  } catch {
    return;
  }
  const payload = pushPolicy.parsePayload(raw);
  if (!payload) return;

  event.waitUntil(
    enqueuePushDisplay(async () => {
      if (await browserPushDeliveryIsSuppressed()) return;
      const options = {
        body: payload.body,
        icon: "/icons/skitza-192.png",
        badge: "/icons/skitza-64.png",
        tag: `${SKITZA_NOTIFICATION_TAG_PREFIX}${payload.category}`,
        data: { url: payload.url },
      };
      // A sign-out can establish the durable fence while this push task is
      // already in flight. Re-read it after every earlier await and immediately
      // before the synchronous display call.
      if (await browserPushDeliveryIsSuppressed()) return;
      await self.registration.showNotification(payload.title, options);
      if (
        (await browserPushDeliveryIsSuppressed()) &&
        !(await closeDisplayedSkitzaNotifications())
      ) {
        throw new Error("Suppressed Skitza notifications could not be closed.");
      }
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = pushPolicy.validateRelativeRoute(
    event.notification && event.notification.data && event.notification.data.url,
  );
  if (!url) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (existing) {
        const navigated = await existing.navigate(url);
        await (navigated || existing).focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;

  if (data && data.type === MESSAGE.getVersion) {
    const reply = event.ports && event.ports[0];
    if (reply) {
      reply.postMessage({
        type: MESSAGE.version,
        version: SW_VERSION,
      });
    }
    event.waitUntil(
      (async () => {
        // The previous SK-128 launch presenter marks its read-only online
        // preview aria-busy, so it stops before requesting the normal safe
        // activation. It always asks the waiting worker for its version first.
        // Exact public /launch windows have no forms or protected actions, so
        // the replacement may narrowly take over before new client JS runs.
        if (!(await allOpenClientsAreExactPublicLaunch())) return;
        try {
          await self.skipWaiting();
        } catch {
          // Preserve the normal waiting-worker/all-clients-closed fallback.
        }
      })(),
    );
    return;
  }

  if (data && data.type === MESSAGE.pushSuppressionCapability) {
    const reply = event.ports && event.ports[0];
    if (reply) {
      reply.postMessage({
        type: MESSAGE.pushSuppressionCapabilityResult,
        supported: true,
        flushSupported:
          typeof self.registration.getNotifications === "function",
        version: SW_VERSION,
      });
    }
    return;
  }

  if (data && data.type === MESSAGE.pushSuppressionFlush) {
    const reply = event.ports && event.ports[0];
    const nonce = data.nonce;
    event.waitUntil(
      (async () => {
        let flushed = false;
        if (
          data.version === SW_VERSION &&
          isPushBoundaryNonce(nonce) &&
          (await browserPushDeliveryFenceMatches(nonce))
        ) {
          await pushDisplayWork;
          const notificationsClosed =
            await closeDisplayedSkitzaNotifications();
          flushed =
            notificationsClosed &&
            (await browserPushDeliveryFenceMatches(nonce));
        }
        if (reply) {
          reply.postMessage({
            type: MESSAGE.pushSuppressionFlushResult,
            flushed,
            version: SW_VERSION,
            nonce,
          });
        }
      })(),
    );
    return;
  }

  if (data && data.type === MESSAGE.activateForAccountExit) {
    const reply = event.ports && event.ports[0];
    const nonce = data.nonce;
    event.waitUntil(
      (async () => {
        let activated = false;
        if (
          data.accountExitStarted === true &&
          data.version === SW_VERSION &&
          isPushBoundaryNonce(nonce) &&
          (await browserPushDeliveryFenceMatches(nonce))
        ) {
          try {
            await self.skipWaiting();
            activated = await browserPushDeliveryFenceMatches(nonce);
          } catch {
            activated = false;
          }
        }
        if (reply) {
          reply.postMessage({
            type: MESSAGE.accountExitActivationResult,
            activated,
            version: SW_VERSION,
            nonce,
          });
        }
      })(),
    );
    return;
  }

  if (
    !data ||
    data.type !== MESSAGE.activateOnSafeReopen ||
    data.safeReopen !== true ||
    data.version !== SW_VERSION
  ) {
    return;
  }

  const reply = event.ports && event.ports[0];
  event.waitUntil(
    (async () => {
      const safe = await allOpenClientsAreSafe();
      if (!safe) {
        if (reply) {
          reply.postMessage({
            type: MESSAGE.activationResult,
            activated: false,
          });
        }
        return;
      }

      if (reply) {
        reply.postMessage({
          type: MESSAGE.activationResult,
          activated: true,
        });
      }
      await self.skipWaiting();
    })(),
  );
});
