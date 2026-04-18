"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useGlobalShortcuts } from "~/lib/keyboard/use-shortcuts";

import { ShortcutCheatsheet } from "./shortcut-cheatsheet";

// Wires the global shortcut hook to real UI: owns cheatsheet open state,
// dispatches the sidebar-toggle event, and resolves context-aware
// "create" to a route based on the current path. Sits alongside
// CommandPalette — both are client islands inside the server AppShell.

export function ShortcutsBridge() {
  const [cheatOpen, setCheatOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const openCheatsheet = useCallback(() => {
    setCheatOpen(true);
  }, []);
  const toggleSidebar = useCallback(() => {
    window.dispatchEvent(new CustomEvent("skitza:toggle-sidebar"));
  }, []);
  const createContextAware = useCallback(() => {
    // Default target is "new project" — pipeline is the busiest surface,
    // so it's the pragmatic fallback when nothing else matches.
    if (pathname === "/dashboard/clients") {
      // Clients list listens for this and pops its "Add client" sheet.
      window.dispatchEvent(new CustomEvent("skitza:new-client"));
      return;
    }
    if (pathname.startsWith("/dashboard/contracts")) {
      router.push("/dashboard/contracts");
      return;
    }
    if (pathname.startsWith("/dashboard/portfolio")) {
      router.push("/dashboard/portfolio");
      return;
    }
    router.push("/dashboard/projects/new");
  }, [pathname, router]);

  const handlers = useMemo(
    () => ({ openCheatsheet, toggleSidebar, createContextAware }),
    [openCheatsheet, toggleSidebar, createContextAware],
  );

  useGlobalShortcuts(handlers);

  return (
    <ShortcutCheatsheet
      open={cheatOpen}
      onClose={() => {
        setCheatOpen(false);
      }}
    />
  );
}
