"use client";

import { useEffect } from "react";

// Wires the IntersectionObserver that the source HTML's <script> block
// (lines 1920-1932 of 2026-04-26-landing-restore-source.html) provides.
// Without this, every `.landing-root .reveal-up` element stays at
// opacity 0 forever — see UX critic report 2026-04-26 for the bug.
//
// Mounted once at the top of page.tsx; observes every .reveal-up
// descendant of .landing-root, adds .is-revealed on first intersection,
// then stops watching that element. Falls back to immediate-visible
// when IntersectionObserver is undefined (older Safari, jsdom).
//
// Returns null — pure behaviour, no rendered output.
//
// `runRevealEffect` is exported for the unit test — calling it directly
// is equivalent to React invoking the effect on mount; the returned
// disposer is the same one React would call on unmount. Keeping the
// effect body in a named export means the test does not need jsdom or
// @testing-library/react (in-repo convention is node-env vitest with
// `react-dom/server` only).
export function runRevealEffect(): (() => void) | undefined {
  if (typeof document === "undefined") return undefined;

  const elements = document.querySelectorAll<HTMLElement>(
    ".landing-root .reveal-up",
  );
  if (elements.length === 0) return undefined;

  if (typeof IntersectionObserver === "undefined") {
    elements.forEach((el) => {
      el.classList.add("is-revealed");
    });
    return undefined;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          obs.unobserve(entry.target);
        }
      });
    },
    { root: null, rootMargin: "0px", threshold: 0.15 },
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
