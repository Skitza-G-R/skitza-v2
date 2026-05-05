"use client";

import { useEffect } from "react";

// IntersectionObserver wiring for the v3 landing's scroll-reveal
// primitives (`.sk-reveal`, `.sk-reveal-left`, `.sk-reveal-right`,
// `.sk-reveal-scale` — defined in `apps/web/src/app/globals.css`).
//
// Each primitive starts at `opacity: 0` + a small transform. JS adds
// `.is-in` on first intersection, the CSS transition fires (with an
// optional `.sk-d-1`..`.sk-d-6` stagger delay), and the element settles
// at its rest state. Without this hook, every reveal element on the
// landing stays invisible — the same bug the `.reveal-up` /
// `.is-revealed` predecessor had pre-Phase 3 (UX critic 2026-04-26).
//
// Reduce-motion respect is purely CSS — globals.css forces `opacity: 1`
// + `transform: none` + `transition: none` inside the
// `prefers-reduced-motion: reduce` block, so toggling `.is-in` early
// has no visible jump.
//
// `runRevealEffect` is exported for the unit test — calling it directly
// is equivalent to React invoking the effect on mount; the returned
// disposer is the same one React would call on unmount. Keeping the
// effect body in a named export means the test does not need jsdom or
// @testing-library/react (in-repo convention is node-env vitest with
// `react-dom/server` only).
const REVEAL_SELECTOR =
  ".sk-reveal, .sk-reveal-left, .sk-reveal-right, .sk-reveal-scale";

export function runRevealEffect(): (() => void) | undefined {
  if (typeof document === "undefined") return undefined;

  const elements = document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
  if (elements.length === 0) return undefined;

  if (typeof IntersectionObserver === "undefined") {
    elements.forEach((el) => {
      el.classList.add("is-in");
    });
    return undefined;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          obs.unobserve(entry.target);
        }
      });
    },
    { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  elements.forEach((el) => {
    observer.observe(el);
  });

  return () => {
    observer.disconnect();
  };
}

export function RevealOnScroll() {
  useEffect(() => runRevealEffect(), []);
  return null;
}
