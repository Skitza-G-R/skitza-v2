"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

// Global keyboard-shortcut layer. Patterned after Linear/Superhuman:
// two-key navigation (`g` then one of t/m/p/s), single-key actions
// (`c`, `/`, `?`, `[`), and `Esc` to close open overlays. We skip
// when the user is typing into an input/textarea/contenteditable
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

// G-leader navigation map. Exported so the test suite can assert the
// routes stay in sync with the 6-page producer surface (Today /
// Clients & Projects / Music / Calendar / Profile / Setup) without
// needing jsdom. `c` (calendar) and `f` (profile) joined the map in
// P2-A-7 alongside the projects → clients-projects rename.
export const G_LEADER_ROUTES = {
  t: "/dashboard",
  m: "/dashboard/music",
  p: "/dashboard/clients-projects",
  c: "/dashboard/calendar",
  f: "/dashboard/profile",
  s: "/dashboard/settings",
} as const;

export type GLeaderKey = keyof typeof G_LEADER_ROUTES;

// Surface-scoped shortcut: bind a single lower-case key on any page
// that wants a quick action (upload, new, toggle done, copy link).
// Same typing-target + modifier guard as the global layer so "typing
// U inside a textarea" never mis-fires an upload.
//
// Callers pass the key as a single character ("u", "n", "t"). The
// handler should do the action (navigate, call a server action, open
// a modal) — the hook registers in the capture phase + calls
// stopImmediatePropagation, which pre-empts the global layer's
// bubble-phase handler. This lets a page override "c" (which is
// global "create") with "c" for "copy share link" on Today without
// both handlers firing on the same keypress.
export function useHotkey(key: string, handler: () => void) {
  // Wrap in useCallback so the effect's deps stay stable across
  // re-renders when the caller passes an inline lambda.
  const stable = useCallback(handler, [handler]);
  useEffect(() => {
    const lower = key.toLowerCase();
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== lower) return;
      e.preventDefault();
      // Block the global keydown listener from seeing this event.
      // Important for keys like "c" where the global default would
      // otherwise fire the context-aware create.
      e.stopImmediatePropagation();
      stable();
    }
    // Capture phase so we win the race against the global layer.
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [key, stable]);
}

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

      // Two-key navigation matches the 4-screen shell. The old 9-route
      // map (p/i/c/l/n/b/r/o/s) collapsed alongside the sidebar in
      // Task 2 — pipeline/inbox/clients/library/contracts/bookings/
      // leads/portfolio/settings became Today / Music / Projects / Setup.
      // Rationale for each letter:
      //   t = Today (the daily dashboard)
      //   m = Music (library / catalog)
      //   p = Projects (per-client work rooms roll up here)
      //   s = Setup (portfolio, settings, account)
      if (gBufferRef.current.timer) {
        if (key in G_LEADER_ROUTES) {
          e.preventDefault();
          clearGBuffer();
          router.push(G_LEADER_ROUTES[key as GLeaderKey]);
          return;
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
      // `n` = new project. Distinct from `c` (context-aware create) so
      // producers anywhere in the app can hit N and land on the new-
      // project form without thinking about which screen they're on.
      // If the current surface wants a different "new", it can layer
      // a useHotkey("n", ...) on top — page-scoped hotkeys register
      // after the global layer and call preventDefault, which wins.
      if (key === "n") {
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
