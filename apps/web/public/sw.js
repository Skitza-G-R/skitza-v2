/* Skitza app-shell Service Worker (Task M.2).
 *
 * Goal: make the installed Tauri Mac app feel "Spotify-fast" by
 * serving the shell + Next.js static chunks from cache on repeat
 * visits, then revalidating in the background.
 *
 * Strategy:
 *   - HTML shell routes (/, /sign-in, etc): **network-first**. HTML
 *     references hash-versioned _next/static chunks; a stale HTML
 *     from a previous deploy points at chunks that no longer exist,
 *     which breaks the page with ERR_FAILED on the chunk URLs. So
 *     we always try network first and only fall back to cache when
 *     offline. Under good network this is identical to no SW for
 *     HTML; under bad/no network it gives offline-friendly fallback.
 *   - /_next/static/* assets: stale-while-revalidate. These are
 *     hash-versioned and immutable, so caching aggressively + lazy
 *     revalidate is safe and fast.
 *
 * Everything else (auth, API, tRPC, Clerk) passes through untouched.
 * Non-GET, cross-origin: always bypass.
 *
 * CACHE_NAME is bumped any time the shell caching contract changes
 * so old caches get cleared during `activate`.
 */

const CACHE_NAME = "skitza-shell-v2";
const SHELL_URLS = [
  "/",
  "/sign-in",
  "/dashboard/clients",
  "/dashboard/projects",
  "/dashboard/library",
];

self.addEventListener("install", (event) => {
  // Pre-warm the static-asset cache only — HTML is network-first so
  // there's no value in pre-fetching it on install.
  event.waitUntil(caches.open(CACHE_NAME));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStaticAsset = url.pathname.startsWith("/_next/static/");
  const isShellRoute = SHELL_URLS.includes(url.pathname);
  if (!isStaticAsset && !isShellRoute) return;

  if (isShellRoute) {
    // Network-first for HTML: deploys swap hashed chunk filenames, so
    // stale HTML from a previous deploy points at 404 chunks. Always
    // try network, fall back to cache only on fetch failure.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok && res.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(req);
          if (cached) return cached;
          throw new Error("offline");
        }
      })(),
    );
    return;
  }

  // Stale-while-revalidate for hashed static assets. Safe because
  // filenames change whenever contents change.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
