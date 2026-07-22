"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

// Global keyboard-shortcut layer. Patterned after Linear/Superhuman:
// two-key navigation (`g` then a key from G_LEADER_ROUTES) and
// single-key actions (`n`, `?`, `[`). We skip
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
  createNewProject: () => void;
};

// G-leader navigation map. Exported so the test suite can assert the
// routes stay in sync with the 6-page producer surface (Overview /
// Clients & Projects / Music / Calendar / Store / Settings) without
// needing jsdom.
//
// Phase 2 (2026-05-05) remap to match the locked design's
// `ShortcutsHelp` (notes/nav.jsx) and the relabelled sidebar:
//   - `h` (new) — Overview            → /dashboard
//                  Was `t` previously.
//   - `s` shifts — Store               → /dashboard/store
//                  Was Setup → /dashboard/settings.
//   - `t` shifts — Settings            → /dashboard/settings
//                  Was Today → /dashboard.
//   - `f` removed (Profile is now reached via `s`).
//   - `p`, `m`, `c` unchanged.
//
// Sidebar G-shortcut hints (NAV_ITEMS in
// `~/components/nav/producer-sidebar.tsx`) and the visible surfaces
// (CommandPalette + ShortcutCheatsheet) read from the same mapping
// conceptually — keep these aligned when extending.
export const G_LEADER_ROUTES = {
  h: "/dashboard",
  m: "/dashboard/music",
  p: "/dashboard/clients-projects",
  c: "/dashboard/calendar",
  s: "/dashboard/store",
  t: "/dashboard/settings",
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
// bubble-phase handler when both layers use the same key.
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

      // Two-key navigation follows the canonical producer routes in
      // G_LEADER_ROUTES. Visible hints are limited to this exact map.
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
      // `n` = new project. Producers anywhere in the app can hit N
      // and open the canonical new-project flow.
      // If the current surface wants a different "new", it can layer
      // a useHotkey("n", ...) on top; its capture-phase listener stops
      // the event before the global bubble-phase listener receives it.
      if (key === "n") {
        e.preventDefault();
        handlers.createNewProject();
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
