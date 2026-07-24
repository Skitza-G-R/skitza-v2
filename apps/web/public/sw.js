/* Skitza installable-web-app service worker.
 *
 * This worker deliberately has a very small cache surface:
 * hash-versioned Next static assets plus a short allowlist of public PWA
 * resources. Authenticated HTML/RSC/API data, Clerk traffic, action routes,
 * signed URLs, uploads, and audio are always network-only.
 *
 * A replacement worker never calls skipWaiting during install. It can take
 * over only after the client observed this exact version before the current
 * page boot, requests activation from a safe reopen, and every open Skitza
 * window confirms that it has no active or protected work.
 */

importScripts("/pwa/cache-policy.js");
importScripts("/pwa/push-policy.js");

const SW_VERSION = "2026-07-24-sk116-2";
const CACHE_PREFIX = "skitza-native-";
const CACHE_NAME = `${CACHE_PREFIX}${SW_VERSION}`;
const OBSOLETE_CACHE_PREFIX = "skitza-shell-";
const OFFLINE_URL = "/offline.html";
const PUSH_DELIVERY_CONTROL_CACHE = "skitza-push-control-v1";
const PUSH_DELIVERY_SUPPRESSED_URL = "/pwa/push-delivery-suppressed";
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
  activateOnSafeReopen: "SKITZA_ACTIVATE_ON_SAFE_REOPEN",
  activationResult: "SKITZA_ACTIVATION_RESULT",
  clientSafetyQuery: "SKITZA_CLIENT_SAFETY_QUERY",
  getVersion: "SKITZA_GET_VERSION",
  version: "SKITZA_VERSION",
};
const CLIENT_SAFETY_TIMEOUT_MS = 1500;

const policy = self.SkitzaCachePolicy;
const pushPolicy = self.SkitzaPushPolicy;

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

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkWithOfflineBoundary(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("Skitza is offline. Reconnect and try again.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);

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
    (async () => {
      if (await browserPushDeliveryIsSuppressed()) return;
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/skitza-192.png",
        badge: "/icons/skitza-64.png",
        tag: `skitza-${payload.category}`,
        data: { url: payload.url },
      });
    })(),
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
