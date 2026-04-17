"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Global keyboard-shortcut layer. Patterned after Linear/Superhuman:
// two-key navigation (`g` then one of p/c/b/l/o/s), single-key
// actions (`c`, `/`, `?`, `[`), and `Esc` to close open overlays.
// We skip when the user is typing into an input/textarea/contenteditable
// so the shortcuts never interrupt real writing. Modifier combos
// (⌘/Ctrl/Alt) are allowed through untouched — cmdk owns ⌘K.

// Exported so it can be unit-tested without a DOM. Stays narrow: the
// signature accepts EventTarget | null because that's what KeyboardEvent
// gives us, and the function handles the non-HTMLElement case cleanly.
export function isTypingTarget(el: unknown): boolean {
  if (el === null || el === undefined) return false;
  if (typeof HTMLElement === "undefined") return false;
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export type ShortcutHandlers = {
  openCheatsheet: () => void;
  toggleSidebar: () => void;
  createContextAware: () => void;
};

export function useGlobalShortcuts(handlers: ShortcutHandlers) {
  const router = useRouter();
  const gBufferRef = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null });

  useEffect(() => {
    function clearGBuffer() {
      if (gBufferRef.current.timer) {
        clearTimeout(gBufferRef.current.timer);
        gBufferRef.current.timer = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // let modifier combos through
      const key = e.key.toLowerCase();

      // Two-key navigation: g then one of p/c/b/l/o/s.
      if (gBufferRef.current.timer) {
        const navKey = key === "p" || key === "c" || key === "b" || key === "l" || key === "o" || key === "s";
        if (navKey) {
          e.preventDefault();
          clearGBuffer();
          switch (key) {
            case "p":
              router.push("/dashboard");
              return;
            case "c":
              router.push("/dashboard/contracts");
              return;
            case "b":
              router.push("/dashboard/booking");
              return;
            case "l":
              router.push("/dashboard/leads");
              return;
            case "o":
              router.push("/dashboard/portfolio");
              return;
            case "s":
              router.push("/dashboard/settings");
              return;
          }
        }
        // Not a nav key — drop the buffer and fall through to single-key handling.
        clearGBuffer();
      }

      if (key === "g") {
        clearGBuffer();
        gBufferRef.current.timer = setTimeout(() => {
          gBufferRef.current.timer = null;
        }, 800);
        return; // don't match single-key handlers for `g`
      }
      if (key === "?") {
        e.preventDefault();
        handlers.openCheatsheet();
        return;
      }
      if (key === "[") {
        e.preventDefault();
        handlers.toggleSidebar();
        return;
      }
      if (key === "c") {
        e.preventDefault();
        handlers.createContextAware();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearGBuffer();
    };
  }, [router, handlers]);
}
