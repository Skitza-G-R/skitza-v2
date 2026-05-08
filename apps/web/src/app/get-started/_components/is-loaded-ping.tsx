"use client";

import { useEffect } from "react";

// Ad funnel's mirror of the homepage's `.page-loaded` chained-class.
// 100ms after mount, adds `.is-loaded` to the nearest .get-started-root
// ancestor — that triggers the .hero-word stagger. Chained class, NOT
// descendant combinator (CLAUDE.md mistake log 2026-04-26 / homepage
// ADR-2). The CSS rule is `.get-started-root.is-loaded .hero-word`.
//
// 100 ms delay matches the homepage. Long enough that the first paint
// is the still state (no flash of un-faded text); short enough that
// the visitor doesn't notice a stagger lag.

export function IsLoadedPing() {
  useEffect(() => {
    const root = document.querySelector(".get-started-root");
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
