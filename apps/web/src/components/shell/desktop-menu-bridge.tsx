"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";

import { onTauriMenuAction } from "~/lib/desktop/bridge";

// Desktop-only: bridge native menu bar clicks (and the ⌥⌘Space global
// shortcut "open-palette" signal) to existing frontend behaviours.
//
// Ids emitted from the Rust side are the canonical source of truth;
// the switch below must stay in sync with `main.rs`. Unknown ids are
// silently ignored so shipping a new menu item Rust-side before the
// web ships a handler is harmless.
//
// Mounted inside AppShell next to CommandPalette — outside Tauri the
// subscription no-ops and this component renders nothing.
export function DesktopMenuBridge() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const state: { cancelled: boolean; unlisten: (() => void) | null } = {
      cancelled: false,
      unlisten: null,
    };
    onTauriMenuAction((action) => {
      switch (action) {
        case "new-deal":
          // Legacy menu action id kept for compatibility with the
          // parallel desktop build — it still emits "new-deal".
          router.push("/dashboard/projects/new");
          return;
        case "new-contract":
          // Contracts no longer have their own top-level page —
          // they're authored inside a Project Room. Route to "new
          // project" and let the producer pick up the contract flow
          // from there.
          router.push("/dashboard/projects/new");
          return;
        case "toggle-dark":
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          return;
        case "toggle-sidebar":
          window.dispatchEvent(new CustomEvent("skitza:toggle-sidebar"));
          return;
        case "open-palette":
          // CommandPalette listens for this event and flips its state.
          window.dispatchEvent(new CustomEvent("skitza:open-palette"));
          return;
        default:
          return;
      }
    }).then(
      (handler) => {
        if (state.cancelled) {
          handler();
        } else {
          state.unlisten = handler;
        }
      },
      () => {
        // Subscription is a no-op outside Tauri; ignore any failure.
      },
    );
    return () => {
      state.cancelled = true;
      if (state.unlisten) state.unlisten();
    };
  }, [router, resolvedTheme, setTheme]);

  return null;
}
