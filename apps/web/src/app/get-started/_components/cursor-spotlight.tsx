"use client";

import { useEffect } from "react";

// Cursor-following spotlight. A soft amber glow tracks the mouse
// across the page, adding tactile interactivity without competing
// with the form / demo as the conversion lever.
//
// Implementation: this component sets two CSS custom properties on
// the .get-started-root element on every mousemove:
//   --gs-mx: cursor X in pixels (relative to viewport)
//   --gs-my: cursor Y in pixels
// The spotlight pseudo-element in get-started.css reads them via
// `radial-gradient(circle at var(--gs-mx, 50vw) var(--gs-my, 30vh), ...)`.
//
// Throttling: requestAnimationFrame coalesces updates so we paint at
// most once per frame even if the browser fires 200 mousemoves/s.
//
// Touch devices: pointer:fine media-query in the CSS hides the
// spotlight on touch — no value when there's no cursor to track.

export function CursorSpotlight() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".get-started-root");
    if (!root) return;

    let pendingX = 0;
    let pendingY = 0;
    let queued = false;

    function flush(): void {
      queued = false;
      root?.style.setProperty("--gs-mx", `${String(pendingX)}px`);
      root?.style.setProperty("--gs-my", `${String(pendingY)}px`);
    }

    function onMove(e: MouseEvent): void {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!queued) {
        queued = true;
        requestAnimationFrame(flush);
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return null;
}
