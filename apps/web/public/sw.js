/* Skitza app-shell Service Worker (Task M.2).
 *
 * Goal: make the installed Tauri Mac app feel "Spotify-fast" by
 * serving the shell + Next.js static chunks from cache on repeat
 * visits, then revalidating in the background.
 *
 * Strategy: stale-while-revalidate for
 *   - top-level shell HTML routes we know the user hits constantly
 *     (/, /sign-in, /dashboard/clients, /dashboard/projects,
 *     /dashboard/library)
 *   - every /_next/static/* asset (hashed, immutable — cache
 *     aggressively, revalidate lazily)
 *
 * Everything else passes through untouched so auth, API, tRPC,
 * Clerk, and Vercel's own caching headers keep working.
 *
 * Scope: only same-origin GETs. Non-GET, cross-origin, Clerk, and
 * API calls all bypass — mutations and auth MUST NOT be cached.
 *
 * Bump CACHE_NAME when the shell URL list changes so old caches get
 * cleared during `activate`.
 */

const CACHE_NAME = "skitza-shell-v1";
const SHELL_URLS = [
  "/",
  "/sign-in",
  "/dashboard/clients",
  "/dashboard/projects",
  "/dashboard/library",
];

self.addEventListener("install", (event) => {
  // Pre-warm the cache with known-good shell routes. `addAll` is
  // atomic — a single failure aborts the whole install — so we wrap
  // each fetch individually and tolerate per-URL failure (a brand
  // new deploy may not have every route prebuilt yet).
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "include" });
            if (res.ok) await cache.put(url, res);
          } catch {
            // Network down at install — no fatal consequence; the
            // fetch handler will cache on first real visit.
          }
        }),
      );
    })(),
  );
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

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          // Only cache successful, basic responses. Opaque/error
          // responses would poison the cache for future hits.
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
