"use client";

import { useEffect } from "react";

// Registers the app-shell Service Worker (Task M.2).
//
// The SW lives at `/public/sw.js` so it's served from the origin
// root (Service Worker scope rules require that). It caches the
// known-good shell routes and Next.js static chunks with a
// stale-while-revalidate strategy — dramatically reducing perceived
// load time for repeat visits, which is the whole point when the
// installed Mac app boots straight into /sign-in -> /dashboard.
//
// Safety rails:
//   * Registration is deferred until `window.load` so it doesn't
//     compete with first-paint critical work.
//   * Any registration failure is swallowed — the app must keep
//     working if the SW can't install (incognito, odd browsers,
//     corporate proxies). This is progressive enhancement, not a
//     hard dependency.
//   * No opinions in dev: Next.js dev mode serves no stable asset
//     URLs for the SW to cache usefully. We still register so the
//     dev cycle matches prod, but the SW only touches `/_next/static/`
//     which is empty-ish in dev — net effect is near-zero.
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignore — SW is a perf enhancement, not a requirement.
      });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        window.removeEventListener("load", onLoad);
      };
    }
  }, []);

  return null;
}
