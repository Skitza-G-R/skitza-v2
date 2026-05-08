"use client";

import { useEffect } from "react";

// Add `.is-loaded` to the .landing-v3-root wrapper 100ms after mount.
// That triggers the homepage's `.landing-v3-root.is-loaded .hero-word`
// stagger (chained class — homepage ADR-2). Same primitive as the
// homepage uses for its own first-paint hero animation.

export function IsLoadedPing() {
  useEffect(() => {
    const root = document.querySelector(".landing-v3-root");
    if (!root) return;
    const t = setTimeout(() => {
      root.classList.add("is-loaded");
    }, 100);
    return () => {
      clearTimeout(t);
    };
  }, []);
  return null;
}
