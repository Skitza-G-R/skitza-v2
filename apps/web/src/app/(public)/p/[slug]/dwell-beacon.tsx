"use client";

import { useEffect } from "react";

// Client-side dwell beacon. Rendered only when the public portfolio URL
// contains `?via=<viewId>` — i.e. the visitor arrived via a magic link.
//
// Fires once when the tab is hidden (user navigates away, switches tabs,
// closes the tab). Uses `navigator.sendBeacon` which is specifically
// designed for this — browsers hold the network connection open to let
// the payload ship even as the page is being torn down.
//
// The server-side endpoint does first-write-wins, so if the user comes
// back and leaves again the second beacon is discarded. This matches
// the intended semantic: "how long did this lead spend on first view?"
const MAX_DWELL_MS = 2 * 60 * 60 * 1000; // keep in sync with route.ts Body schema

interface BeaconInit {
  // `crypto.randomUUID()` is available in all modern browsers (including
  // Safari 15.4+ and Chrome 92+). No fallback because the viewId itself
  // already is a UUID; this doesn't matter.
  viewId: string;
}

export function DwellBeacon({ viewId }: BeaconInit) {
  useEffect(() => {
    const startedAt = Date.now();
    let sent = false;

    function fire() {
      if (sent) return;
      const dwellMs = Math.min(Date.now() - startedAt, MAX_DWELL_MS);
      // Round to 100ms to reduce noise + trim a few bytes.
      const rounded = Math.round(dwellMs / 100) * 100;
      const payload = JSON.stringify({ dwellMs: rounded });

      // Prefer sendBeacon so the browser guarantees delivery even if the
      // page is being unloaded. Fall back to fetch with keepalive for
      // environments where Beacon is unavailable (old Firefox, some
      // in-app browsers).
      try {
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
          const blob = new Blob([payload], { type: "application/json" });
          const ok = navigator.sendBeacon(`/api/views/${viewId}/dwell`, blob);
          if (ok) {
            sent = true;
            return;
          }
        }
      } catch {
        // fall through to fetch fallback
      }
      try {
        void fetch(`/api/views/${viewId}/dwell`, {
          method: "POST",
          body: payload,
          headers: { "content-type": "application/json" },
          keepalive: true,
        });
        sent = true;
      } catch {
        // best-effort — dwell analytics is not worth crashing the page
      }
    }

    // `visibilitychange` (hidden) is the reliable signal across browsers;
    // `pagehide` catches bfcache restores + some iOS Safari cases.
    function onVisibility() {
      if (document.visibilityState === "hidden") fire();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", fire);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", fire);
    };
  }, [viewId]);

  return null;
}
