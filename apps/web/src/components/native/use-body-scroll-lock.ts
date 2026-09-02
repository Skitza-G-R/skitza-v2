"use client";

import { useEffect } from "react";

/**
 * The body declarations that hold the document still while a full-screen
 * surface is open.
 *
 * `overflow: hidden` alone is not enough on iOS. A phone-sized page behind the
 * overlay still has a scrollable range, and Safari scrolls the *document* to
 * reveal a focused field when the software keyboard opens. Fixed elements
 * travel with that scroll while the keyboard is up, so the overlay slides off
 * the top of the screen and the page underneath shows through below it —
 * and `visualViewport.offsetTop` never reports it, so
 * `--sk-viewport-offset-top` cannot compensate.
 *
 * Taking the body out of flow collapses the scrollable range to zero. With
 * nothing to scroll, iOS offsets the visual viewport instead, which the
 * `--sk-viewport-offset-top` anchor already handles.
 */
export function lockedBodyStyle(scrollY: number): Record<string, string> {
  return {
    position: "fixed",
    top: `-${String(Math.max(0, Math.round(scrollY)))}px`,
    left: "0",
    right: "0",
    width: "100%",
    overflow: "hidden",
  };
}

const LOCKED_PROPERTIES = ["position", "top", "left", "right", "width", "overflow"] as const;

/**
 * Holds the document still while `locked` is true, restoring the previous
 * inline styles and scroll position on release.
 *
 * Mount this from any surface that covers the page on a phone without going
 * through Radix Dialog, which brings its own scroll lock.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const previous = Object.fromEntries(
      LOCKED_PROPERTIES.map((property) => [property, body.style.getPropertyValue(property)]),
    );
    const next = lockedBodyStyle(scrollY);

    for (const property of LOCKED_PROPERTIES) {
      body.style.setProperty(property, next[property] ?? "");
    }

    return () => {
      for (const property of LOCKED_PROPERTIES) {
        const value = previous[property];
        if (value) body.style.setProperty(property, value);
        else body.style.removeProperty(property);
      }
      if (scrollY > 0) window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
